        // =============================================================================
        // GLOBAL STATE & UTILITIES
        // =============================================================================
        const appState = {
            portfolio: [],
            watchlist: [],
            history: [],
            alerts: [],
            editingIndex: -1, // -1 means adding new stock, >=0 means editing existing
            apiStatus: 'checking', // 'live', 'offline'
            
            // FUNDAMENTAL ANALYSIS STATE
            userFundamentalCriteria: {
                'Large': {}, 'Mid': {}, 'Small': {}, 'Micro': {}, 'Nano': {}, 'All': {}
            },
            criteriaMode: 'Default', // 'Default' or 'User'
            customFundamentalCriteria: [],
            editingCriteriaId: null, // Tracks the ID of the row being edited for Parameter/Operator
        };

        // -----------------------------------------------------------------
        // PERSISTENCE LAYER
        // -----------------------------------------------------------------
        // Two tiers:
        //  1. localStorage — always used, works instantly, offline-safe.
        //  2. Firebase Firestore — optional cross-device sync. Activated
        //     automatically once firebase-config.js has real keys in it.
        //     Devices "pair" by sharing a Sync Code (a Firestore doc ID),
        //     so no login screen is needed for a personal tracker.
        const STORAGE_KEY = 'stockTrackerData';
        const SYNC_CODE_KEY = 'stockTrackerSyncCode';

        let firestoreDb = null;
        let syncCode = null;
        let firebaseReady = false;

        function isFirebaseConfigured() {
            return typeof firebaseConfig !== 'undefined'
                && firebaseConfig
                && firebaseConfig.apiKey
                && !firebaseConfig.apiKey.startsWith('PASTE_');
        }

        function initFirebase() {
            if (!isFirebaseConfigured() || typeof firebase === 'undefined') {
                updateSyncStatus('off');
                return;
            }
            try {
                firebase.initializeApp(firebaseConfig);
                firestoreDb = firebase.firestore();
                firebaseReady = true;
                syncCode = localStorage.getItem(SYNC_CODE_KEY) || null;
                updateSyncStatus(syncCode ? 'connected' : 'no-code');
            } catch (error) {
                console.error('Firebase init failed:', error);
                updateSyncStatus('error');
            }
        }

        // Call this to link/create a sync code, then push local data up
        // or pull remote data down, whichever the user needs.
        async function setSyncCode(code, direction) {
            if (!code || !code.trim()) return;
            syncCode = code.trim();
            localStorage.setItem(SYNC_CODE_KEY, syncCode);
            if (direction === 'pull') {
                await loadAppState();
                loadPortfolio();
                renderAlerts();
                renderFundamentalCriteriaTable();
            } else {
                await saveAppState();
            }
            updateSyncStatus('connected');
        }

        function updateSyncStatus(state) {
            const el = document.getElementById('sync-status');
            if (!el) return;
            const labels = {
                off: 'Sync: not configured (local only)',
                'no-code': 'Sync: no code set (local only)',
                connected: `Sync: on \u2014 code ${syncCode || ''}`,
                error: 'Sync: error (local only)',
            };
            el.textContent = labels[state] || '';
        }

        async function loadAppState() {
            // Try Firestore first (if paired), otherwise fall back to
            // whatever is cached locally.
            if (firebaseReady && firestoreDb && syncCode) {
                try {
                    const doc = await firestoreDb.collection('trackers').doc(syncCode).get();
                    if (doc.exists) {
                        const saved = doc.data();
                        Object.assign(appState, {
                            portfolio: saved.portfolio || [],
                            watchlist: saved.watchlist || [],
                            history: saved.history || [],
                            alerts: saved.alerts || [],
                            userFundamentalCriteria: saved.userFundamentalCriteria || appState.userFundamentalCriteria,
                            customFundamentalCriteria: saved.customFundamentalCriteria || [],
                        });
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
                        return;
                    }
                } catch (error) {
                    console.error('Firestore load failed, using local cache:', error);
                }
            }
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const saved = JSON.parse(raw);
                    Object.assign(appState, {
                        portfolio: saved.portfolio || [],
                        watchlist: saved.watchlist || [],
                        history: saved.history || [],
                        alerts: saved.alerts || [],
                        userFundamentalCriteria: saved.userFundamentalCriteria || appState.userFundamentalCriteria,
                        customFundamentalCriteria: saved.customFundamentalCriteria || [],
                    });
                }
            } catch (error) {
                console.log('No saved data found, starting fresh:', error);
            }
        }

        async function saveAppState() {
            const payload = {
                portfolio: appState.portfolio,
                watchlist: appState.watchlist,
                history: appState.history,
                alerts: appState.alerts,
                userFundamentalCriteria: appState.userFundamentalCriteria,
                customFundamentalCriteria: appState.customFundamentalCriteria,
            };
            // Always cache locally so the app still works offline / without sync.
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
            } catch (error) {
                console.error('Local storage error:', error);
                showNotification('Could not save your data locally.', true);
            }
            // Mirror to Firestore when paired, so other devices see the update.
            if (firebaseReady && firestoreDb && syncCode) {
                try {
                    await firestoreDb.collection('trackers').doc(syncCode).set(payload);
                } catch (error) {
                    console.error('Firestore save failed (data is still saved locally):', error);
                    showNotification('Saved locally, but cloud sync failed.', true);
                }
            }
        }


        const dashboardCharts = {};

        // Market Cap Defaults for Fundamental Analysis (Mock Data)
        const marketCapDefaults = {
            'Large': {
                'P/E Ratio': '35',
                'Promoter holding': '45%',
                'Market capitalization': '180000',
            },
            'Mid': {
                'P/E Ratio': '50',
                'Promoter holding': '40%',
                'Market capitalization >': '40000',
                'Market capitalization <': '180000',
            },
            'Small': {
                'P/E Ratio': '70',
                'Promoter holding': '35%',
                'Market capitalization >': '5000',
                'Market capitalization <': '40000',
            },
            'Micro': {
                'P/E Ratio': '100',
                'Promoter holding': '30%',
                'Market capitalization <': '5000',
            },
            'Nano': {
                'P/E Ratio': '150',
                'Promoter holding': '25%',
                'Market capitalization <': '1000',
            },
            'All': {}
        };

        // Base Criteria for Fundamental Analysis (Mock Data) - Note: Names must be unique keys for user criteria overrides
        const fundamentalCriteria = [
            { name: "P/E Ratio", operator: "<", baseValue: "40" },
            { name: "Price to book value", operator: "<", baseValue: "6" },
            { name: "Debt to equity", operator: "<", baseValue: "0.5" },
            { name: "Return on equity", operator: ">", baseValue: "15%" },
            { name: "Sales growth 3 Years", operator: ">", baseValue: "10%" },
            { name: "Net profit", operator: ">", baseValue: "0" },
            { name: "Promoter holding", operator: ">", baseValue: "40%" },
            { name: "Net block", operator: ">", baseValue: "1.2 * Net block 3 Years back" },
            { name: "Market capitalization", operator: ">", baseValue: "400" },
            { name: "Market capitalization", operator: "<", baseValue: "180000" },
            { name: "Tax last year", operator: ">", baseValue: "0.22 * Net profit last year" },
            { name: "Tax preceding year", operator: ">", baseValue: "0.22 * Net profit preceding year" },
            { name: "Return on assets", operator: ">", baseValue: "9%" },
            { name: "Return on assets 3 Years", operator: ">", baseValue: "9%" },
            { name: "Return on assets 5 years", operator: ">", baseValue: "9%" },
            { name: "OPM 5 Year", operator: ">", baseValue: "13%" },
            { name: "OPM 10 Year", operator: ">", baseValue: "12%" },
            { name: "EPS 3 Years", operator: ">", baseValue: "0%" },
            { name: "EPS 5 Years", operator: ">", baseValue: "0%" },
        ];


        function saveToLocalStorage() {
            // Kept the original function name so all existing call sites still work;
            // it now persists via the artifact storage API instead of localStorage.
            saveAppState();
        }

        function showTab(tabId, element) {
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');

            document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
            element.classList.add('active');
            
            // Render content for active tabs that need dynamic loading
            if (tabId === 'dashboard') {
                updateDashboard();
            } else if (tabId === 'history') {
                renderHistoryTable();
            } else if (tabId === 'watchlist') {
                renderWatchlistTable();
            } else if (tabId === 'alerts') {
                renderAlerts();
            } else if (tabId === 'market') {
                loadMarketOverview();
            } else if (tabId === 'fundamental-analysis') {
                // Now calls the renamed function
                renderFundamentalCriteriaTable();
            }
        }

        function formatCurrency(value) {
            if (isNaN(value) || value === null || value === undefined) return '₹0';
            return '₹' + parseFloat(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        }

        function formatPercentage(value) {
            if (isNaN(value) || value === null || value === undefined) return 'N/A';
            const sign = value >= 0 ? '+' : '';
            return sign + parseFloat(value).toFixed(2) + '%';
        }

        function formatPercent(value) {
            if (isNaN(value) || value === null || value === undefined) return '0.00%';
            const sign = value >= 0 ? '+' : '';
            return sign + parseFloat(value).toFixed(2) + '%';
        }

        function showNotification(message, isError = false) {
            const notification = document.getElementById('notification');
            notification.textContent = message;
            notification.className = isError ? 'notification error' : 'notification';
            notification.style.display = 'block';
            setTimeout(() => {
                notification.style.display = 'none';
            }, 3000);
        }

        function getPnLClass(value) {
            if (isNaN(value) || value === null) return 'neutral';
            return value >= 0 ? 'positive' : 'negative';
        }

        function getCheckedValues(prefix) {
            const values = {};
            document.querySelectorAll(`input[id^="${prefix}-"]`).forEach(checkbox => {
                values[checkbox.value] = checkbox.checked;
            });
            return values;
        }

        function renderCheckboxStatus(stock, type, key) {
            if (!stock[type]) return '<span>-</span>';
            const isChecked = stock[type][key];
            const className = isChecked ? 'positive' : 'neutral';
            return `<span class="${className}">${isChecked ? '✓' : '-'}</span>`;
        }

        function calculateDaysHeld(buyDateStr, currentDateStr) {
            const buyDate = new Date(buyDateStr);
            const currentDate = new Date(currentDateStr);
            const diffTime = Math.abs(currentDate - buyDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays;
        }


        // =============================================================================
        // LIVE (DELAYED) PRICE FETCHING — free, no API key, no cost
        // =============================================================================
        // Uses Yahoo Finance's public chart endpoint, which is free and needs no
        // signup/key. Indian market data through it is delayed roughly 15 minutes,
        // which is fine for a personal tracker. Browsers can't call it directly
        // (Yahoo doesn't allow cross-origin requests), so each call is routed
        // through a free public CORS proxy. Several proxies are tried in order
        // in case one is temporarily down; if all fail, mock data is used so the
        // app never breaks.
        const CORS_PROXIES = [
            (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
            (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
        ];

        async function fetchWithProxies(targetUrl, timeoutMs = 6000) {
            let lastError = null;
            for (const buildProxyUrl of CORS_PROXIES) {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    const response = await fetch(buildProxyUrl(targetUrl), { signal: controller.signal });
                    clearTimeout(timer);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return await response.json();
                } catch (error) {
                    clearTimeout(timer);
                    lastError = error;
                    // try the next proxy
                }
            }
            throw lastError || new Error('All CORS proxies failed');
        }

        // Tries NSE (.NS) first, then BSE (.BO), since most tickers here are NSE.
        async function fetchYahooChart(symbol) {
            const suffixes = ['.NS', '.BO'];
            let lastError = null;
            for (const suffix of suffixes) {
                const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}${suffix}?interval=1d&range=1mo`;
                try {
                    const data = await fetchWithProxies(yahooUrl);
                    const result = data && data.chart && data.chart.result && data.chart.result[0];
                    if (result && result.meta && typeof result.meta.regularMarketPrice === 'number') {
                        return result;
                    }
                } catch (error) {
                    lastError = error;
                }
            }
            throw lastError || new Error(`No data for ${symbol}`);
        }

        function percentChangeFromCloses(closes, indexFromEnd, currentPrice) {
            if (!closes || closes.length <= indexFromEnd) return 0;
            const past = closes[closes.length - 1 - indexFromEnd];
            if (!past) return 0;
            return ((currentPrice - past) / past) * 100;
        }

        function generateMockPriceData(symbol) {
            const basePrice = 100 + Math.random() * 2000;
            const change = (Math.random() - 0.5) * basePrice * 0.05;
            return {
                symbol: symbol,
                price: basePrice,
                previousClose: basePrice - change,
                change: change,
                changePercent: (change / (basePrice - change)) * 100,
                high: basePrice + Math.random() * 50,
                low: basePrice - Math.random() * 50,
                volume: Math.floor(Math.random() * 1000000),
                longName: `${symbol} Limited`,
                success: false,
                historic: {
                    price3d: (Math.random() - 0.5) * 5,
                    price1w: (Math.random() - 0.5) * 10,
                    price24d: (Math.random() - 0.5) * 20,
                    volume3d: (Math.random() - 0.5) * 10,
                    volume1w: (Math.random() - 0.5) * 15,
                    volume24d: (Math.random() - 0.5) * 25,
                }
            };
        }

        /**
         * Fetches a real (≈15-min delayed) quote for an Indian stock via a free,
         * keyless API. Falls back to mock data automatically if the network
         * call fails, so the rest of the app keeps working either way.
         */
        async function fetchStockPrice(symbol) {
            try {
                const result = await fetchYahooChart(symbol);
                const meta = result.meta;
                const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
                const closes = quote && quote.close ? quote.close.filter(v => v !== null && v !== undefined) : [];

                const price = meta.regularMarketPrice;
                const prevClose = meta.previousClose || meta.chartPreviousClose || price;
                const change = price - prevClose;

                appState.apiStatus = 'live';
                updateApiStatus();

                return {
                    symbol: symbol,
                    price: price,
                    previousClose: prevClose,
                    change: change,
                    changePercent: prevClose ? (change / prevClose) * 100 : 0,
                    high: meta.regularMarketDayHigh || price,
                    low: meta.regularMarketDayLow || price,
                    volume: meta.regularMarketVolume || 0,
                    longName: meta.longName || meta.shortName || `${symbol} Limited`,
                    success: true,
                    historic: {
                        price3d: percentChangeFromCloses(closes, 3, price),
                        price1w: percentChangeFromCloses(closes, 5, price),
                        price24d: percentChangeFromCloses(closes, closes.length - 1, price),
                        volume3d: 0,
                        volume1w: 0,
                        volume24d: 0,
                    }
                };
            } catch (error) {
                console.warn(`Live price fetch failed for ${symbol}, using mock data:`, error.message);
                if (appState.apiStatus !== 'offline') {
                    appState.apiStatus = 'offline';
                    updateApiStatus();
                }
                return generateMockPriceData(symbol);
            }
        }


        // =============================================================================
        // UI & STATUS UPDATES
        // =============================================================================
        function updateApiStatus() {
            const statusElement = document.getElementById('api-status');
            switch (appState.apiStatus) {
                case 'live':
                    statusElement.textContent = 'API Status: Live (~15 min delayed)';
                    statusElement.className = 'api-status api-live';
                    break;
                case 'offline':
                    statusElement.textContent = 'API Status: Offline (Using Mock Data)';
                    statusElement.className = 'api-status api-offline';
                    break;
                case 'checking':
                default:
                    statusElement.textContent = 'Checking API...';
                    statusElement.className = 'api-status';
                    break;
            }
        }


        // =============================================================================
        // PORTFOLIO MANAGEMENT
        // =============================================================================
        function resetForm() {
            appState.editingIndex = -1;
            document.getElementById('ticker').value = '';
            document.getElementById('buy-date').value = new Date().toISOString().split('T')[0];
            document.getElementById('quantity').value = '';
            document.getElementById('buy-price').value = '';
            document.getElementById('sector').value = '';
            document.getElementById('market-cap').value = 'Large';
            document.getElementById('latest-high').value = '';
            document.getElementById('down-percent').value = '';
            document.getElementById('target1').value = '';
            document.getElementById('target2').value = '';
            document.getElementById('target3').value = '';
            document.getElementById('interval').value = 'Short';
            document.getElementById('add-stock-btn').textContent = 'Add/Update Stock';
            document.getElementById('reset-form-btn').style.display = 'none';
        }

        async function addOrUpdateStock() {
            const ticker = document.getElementById('ticker').value.toUpperCase().trim();
            const buyDate = document.getElementById('buy-date').value;
            const quantity = parseInt(document.getElementById('quantity').value);
            const buyPrice = parseFloat(document.getElementById('buy-price').value);
            const sector = document.getElementById('sector').value.trim();
            const marketCap = document.getElementById('market-cap').value;
            const latestHigh = parseFloat(document.getElementById('latest-high').value) || 0;
            const downPercent = parseFloat(document.getElementById('down-percent').value) || 0;
            const target1 = parseFloat(document.getElementById('target1').value) || 0;
            const target2 = parseFloat(document.getElementById('target2').value) || 0;
            const target3 = parseFloat(document.getElementById('target3').value) || 0;
            const interval = document.getElementById('interval').value;

            if (!ticker || !buyDate || isNaN(quantity) || quantity <= 0 || isNaN(buyPrice) || buyPrice <= 0) {
                showNotification('Please fill in Ticker, Buy Date, Quantity, and Buy Price with valid values.', true);
                return;
            }

            const apiData = await fetchStockPrice(ticker);

            if (!apiData.success && appState.apiStatus === 'live') {
                showNotification(`Could not get live data for ${ticker}. Please check the ticker symbol.`, true);
                // Allow adding/updating using manual data if API is offline
                if (appState.apiStatus !== 'offline') return;
            }

            const stockData = {
                ticker,
                buyDate,
                quantity,
                buyPrice,
                sector,
                marketCap,
                latestHigh,
                downPercent,
                target1,
                target2,
                target3,
                interval,
                price: apiData.price,
                longName: apiData.longName,
                previousClose: apiData.previousClose,
                changePercent: apiData.changePercent,
                totalInvestment: quantity * buyPrice,
            };

            if (appState.editingIndex === -1) {
                appState.portfolio.push(stockData);
                showNotification(`Stock ${stockData.ticker} added!`);
            } else {
                appState.portfolio[appState.editingIndex] = { ...appState.portfolio[appState.editingIndex], ...stockData };
                showNotification(`Stock ${stockData.ticker} updated!`);
            }

            saveToLocalStorage();
            loadPortfolio();
            resetForm();
        }

        function editStock(index) {
            const stock = appState.portfolio[index];
            appState.editingIndex = index;
            document.getElementById('ticker').value = stock.ticker;
            document.getElementById('buy-date').value = stock.buyDate;
            document.getElementById('quantity').value = stock.quantity;
            document.getElementById('buy-price').value = stock.buyPrice;
            document.getElementById('sector').value = stock.sector || '';
            document.getElementById('market-cap').value = stock.marketCap || 'Large';
            document.getElementById('latest-high').value = stock.latestHigh || '';
            document.getElementById('down-percent').value = stock.downPercent || '';
            document.getElementById('target1').value = stock.target1 || '';
            document.getElementById('target2').value = stock.target2 || '';
            document.getElementById('target3').value = stock.target3 || '';
            document.getElementById('interval').value = stock.interval || 'Short';
            document.getElementById('add-stock-btn').textContent = 'Update Stock';
            document.getElementById('reset-form-btn').style.display = 'inline-block';
            document.getElementById('ticker').focus();
        }

        function sellStock(index) {
            const stock = appState.portfolio[index];
            const currentInvestment = stock.buyPrice * stock.quantity;
            
            // Mock sale at current price
            const soldPrice = stock.price; 
            const pnlValue = (soldPrice * stock.quantity) - currentInvestment;
            const pnlPercent = (pnlValue / currentInvestment) * 100;
            const soldDate = new Date().toISOString().split('T')[0];
            const daysHeld = calculateDaysHeld(stock.buyDate, soldDate);

            if (confirm(`Are you sure you want to mark ${stock.ticker} (${stock.quantity} shares) as sold at ₹${soldPrice.toFixed(2)}? P&L: ${formatCurrency(pnlValue)}`)) {
                
                const historyEntry = {
                    ticker: stock.ticker,
                    buyDate: stock.buyDate,
                    soldDate: soldDate,
                    daysHeld: daysHeld,
                    quantity: stock.quantity,
                    buyPrice: stock.buyPrice,
                    soldPrice: soldPrice,
                    pnlValue: pnlValue,
                    pnlPercent: pnlPercent,
                    marketCap: stock.marketCap || 'N/A',
                    sector: stock.sector || 'N/A',
                    remarks: `Sold at Market Price`,
                };
                appState.history.unshift(historyEntry);
                appState.portfolio.splice(index, 1);
                saveToLocalStorage();
                loadPortfolio();
                showNotification(`Stock ${stock.ticker} sold and transaction recorded in History.`);
            }
        }

        function deleteStock(index) {
            const stock = appState.portfolio[index];
            if (confirm(`Are you sure you want to delete ${stock.ticker} from your portfolio? This will be recorded as a complete loss in History.`)) {
                const currentInvestment = stock.buyPrice * stock.quantity;
                const historyEntry = {
                    ticker: stock.ticker,
                    buyDate: stock.buyDate,
                    soldDate: new Date().toISOString().split('T')[0],
                    daysHeld: calculateDaysHeld(stock.buyDate, new Date().toISOString().split('T')[0]),
                    quantity: stock.quantity,
                    buyPrice: stock.buyPrice,
                    soldPrice: 0,
                    pnlValue: -currentInvestment,
                    pnlPercent: -100,
                    marketCap: stock.marketCap || 'N/A',
                    sector: stock.sector || 'N/A',
                    remarks: 'Holding Deleted/Written Off',
                };
                appState.history.unshift(historyEntry);
                appState.portfolio.splice(index, 1);
                saveToLocalStorage();
                loadPortfolio();
                showNotification('Stock deleted and transaction recorded in History.');
            }
        }

        async function refreshAllPrices() {
            showNotification('Refreshing all stock prices...');
            const fetchPromises = appState.portfolio.map(stock => fetchStockPrice(stock.ticker));
            const results = await Promise.all(fetchPromises);
            
            results.forEach((data, index) => {
                const stock = appState.portfolio[index];
                if (data.success || appState.apiStatus === 'offline') {
                    stock.price = data.price;
                    stock.longName = data.longName;
                    stock.previousClose = data.previousClose;
                    stock.changePercent = data.changePercent;
                }
            });

            saveToLocalStorage();
            renderPortfolioTable();
            showNotification('All prices updated!');
        }

        async function loadPortfolio() {
            if (appState.apiStatus === 'live' && appState.portfolio.every(stock => stock.price)) {
                renderPortfolioTable();
                return;
            }
            
            if (appState.portfolio.length > 0) {
                await refreshAllPrices();
            } else {
                renderPortfolioTable();
            }
        }

        function renderPortfolioTable() {
            const tbody = document.getElementById('portfolio-tbody');
            let html = '';
            let totalInvested = 0;
            let currentValue = 0;
            let totalHoldings = appState.portfolio.length;

            if (appState.portfolio.length === 0) {
                tbody.innerHTML = '<tr><td colspan="21" class="neutral" style="text-align: center;">No stocks in portfolio. Add a new holding above.</td></tr>';
                renderPortfolioSummary(0, 0, 0, 0, 0);
                return;
            }
            
            appState.portfolio.forEach((stock, i) => {
                const investment = stock.quantity * stock.buyPrice;
                const currentVal = stock.price * stock.quantity;
                const pnl = currentVal - investment;
                const pnlPercent = (pnl / investment) * 100;
                const daysHeld = calculateDaysHeld(stock.buyDate, new Date().toISOString().split('T')[0]);
                
                totalInvested += investment;
                currentValue += currentVal;

                const todayChange = stock.price - stock.previousClose;
                const todayChangePercent = stock.changePercent;
                const latestHigh = stock.latestHigh || stock.price;
                const downPercent = latestHigh > 0 ? ((latestHigh - stock.price) / latestHigh) * 100 : 0;
                
                // Alert Mode Mock Logic
                let alertModeHtml = 'N/A';
                if (stock.price <= stock.buyPrice * (1 - (stock.downPercent / 100))) {
                    alertModeHtml = `<span class="alert-red">S/L Hit!</span>`;
                } else if (stock.price >= stock.target3) {
                    alertModeHtml = `<span class="alert-green">T3 Hit!</span>`;
                } else if (stock.price >= stock.target2) {
                    alertModeHtml = `<span class="alert-blue">T2 Hit!</span>`;
                } else if (stock.price >= stock.target1) {
                    alertModeHtml = `<span class="alert-orange">T1 Hit!</span>`;
                } else if (downPercent >= 5) {
                    alertModeHtml = `<span class="alert-yellow">${downPercent.toFixed(2)}% Down</span>`;
                }


                html += `
                    <tr>
                        <td>${stock.ticker}</td>
                        <td>${stock.buyDate}</td>
                        <td>${stock.quantity}</td>
                        <td>${formatCurrency(stock.buyPrice)}</td>
                        <td>${formatCurrency(stock.price)}</td>
                        <td class="${getPnLClass(todayChangePercent)}">${formatPercentage(todayChangePercent)}</td>
                        <td>${formatCurrency(investment)}</td>
                        <td>${formatCurrency(currentVal)}</td>
                        <td class="${getPnLClass(pnl)}">${formatCurrency(pnl)}</td>
                        <td class="${getPnLClass(pnl)}">${formatPercentage(pnlPercent)}</td>
                        <td>${daysHeld}</td>
                        <td>${formatCurrency(latestHigh)}</td>
                        <td class="${getPnLClass(-downPercent)}">${formatPercentage(downPercent)}</td>
                        <td>${formatCurrency(stock.target1)}</td>
                        <td>${formatCurrency(stock.target2)}</td>
                        <td>${formatCurrency(stock.target3)}</td>
                        <td>${stock.interval}</td>
                        <td>${stock.sector || 'N/A'}</td>
                        <td>${stock.marketCap || 'N/A'}</td>
                        <td>${alertModeHtml}</td>
                        <td class="action-buttons">
                            <button class="btn btn-warning btn-small" onclick="editStock(${i})">Hold/Edit</button>
                            <button class="btn btn-success btn-small" onclick="sellStock(${i})">Sold</button>
                            <button class="btn btn-danger btn-small" onclick="deleteStock(${i})">Delete</button>
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;

            const totalPnL = currentValue - totalInvested;
            const totalPnLPercent = (totalPnL / (totalInvested || 1)) * 100;
            
            renderPortfolioSummary(totalInvested, currentValue, totalPnL, totalPnLPercent, totalHoldings);
        }

        function renderPortfolioSummary(invested, current, pnl, pnlPercent, holdings) {
            document.getElementById('total-invested').textContent = formatCurrency(invested);
            document.getElementById('current-value').textContent = formatCurrency(current);
            const pnlElement = document.getElementById('total-pnl');
            pnlElement.textContent = formatCurrency(pnl);
            pnlElement.className = `summary-value ${getPnLClass(pnl)}`;
            const pnlPercentElement = document.getElementById('total-pnl-percent');
            pnlPercentElement.textContent = formatPercentage(pnlPercent);
            pnlPercentElement.className = `summary-change ${getPnLClass(pnl)}`;
            document.getElementById('total-holdings').textContent = holdings;
        }


        // =============================================================================
        // HISTORY TAB MANAGEMENT
        // =============================================================================
        function renderHistoryTable() {
            const tbody = document.getElementById('history-tbody');
            let html = '';

            if (appState.history.length === 0) {
                tbody.innerHTML = '<tr><td colspan="12" class="neutral" style="text-align: center;">No completed transactions recorded.</td></tr>';
                return;
            }

            appState.history.forEach((transaction, i) => {
                html += `
                    <tr>
                        <td>${transaction.ticker}</td>
                        <td>${transaction.buyDate}</td>
                        <td>${transaction.soldDate}</td>
                        <td>${transaction.daysHeld}</td>
                        <td>${transaction.quantity}</td>
                        <td>${formatCurrency(transaction.buyPrice)}</td>
                        <td>${formatCurrency(transaction.soldPrice)}</td>
                        <td class="${getPnLClass(transaction.pnlValue)}">${formatCurrency(transaction.pnlValue)}</td>
                        <td class="${getPnLClass(transaction.pnlValue)}">${formatPercentage(transaction.pnlPercent)}</td>
                        <td>${transaction.marketCap}</td>
                        <td>${transaction.sector}</td>
                        <td>${transaction.remarks}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }


        // =============================================================================
        // DASHBOARD ANALYSIS & CHARTS
        // =============================================================================
        function calculateChartData() {
            const portfolio = appState.portfolio;
            const sectorData = {};
            const marketCapData = {};

            portfolio.forEach(stock => {
                const investment = stock.quantity * stock.buyPrice;
                const currentVal = stock.price * stock.quantity;
                const pnl = currentVal - investment;
                const totalInvestment = stock.totalInvestment;

                const sec = stock.sector || 'N/A';
                if (!sectorData[sec]) {
                    sectorData[sec] = { invested: 0, profit: 0, loss: 0, totalInvestment: 0 };
                }
                sectorData[sec].invested += totalInvestment;
                sectorData[sec].profit += Math.max(0, pnl);
                sectorData[sec].loss += Math.min(0, pnl);
                sectorData[sec].totalInvestment += totalInvestment;

                const cap = stock.marketCap || 'N/A';
                if (!marketCapData[cap]) {
                    marketCapData[cap] = { invested: 0, profit: 0, loss: 0, totalInvestment: 0 };
                }
                marketCapData[cap].invested += totalInvestment;
                marketCapData[cap].profit += Math.max(0, pnl);
                marketCapData[cap].loss += Math.min(0, pnl);
                marketCapData[cap].totalInvestment += totalInvestment;
            });

            const totalInvested = portfolio.reduce((sum, s) => sum + s.totalInvestment, 0);

            const transformData = (dataMap) => {
                const labels = Object.keys(dataMap);
                const invested = labels.map(key => totalInvested > 0 ? (dataMap[key].invested / totalInvested) * 100 : 0);
                const profit = labels.map(key => dataMap[key].totalInvestment > 0 ? (dataMap[key].profit / dataMap[key].totalInvestment) * 100 : 0);
                const loss = labels.map(key => dataMap[key].totalInvestment > 0 ? (dataMap[key].loss / dataMap[key].totalInvestment) * 100 : 0);
                return { labels, invested, profit, loss };
            };

            return {
                sector: transformData(sectorData),
                marketCap: transformData(marketCapData)
            };
        }

        function createChart(elementId, type, labels, data, title, options = {}) {
            if (dashboardCharts[elementId]) {
                dashboardCharts[elementId].destroy();
            }

            const ctx = document.getElementById(elementId).getContext('2d');
            const colors = [
                '#667eea', '#764ba2', '#10b981', '#f59e0b', '#ef4444', 
                '#3b82f6', '#ec4899', '#f97316', '#a855f7', '#14b8a6'
            ];

            dashboardCharts[elementId] = new Chart(ctx, {
                type: type,
                data: {
                    labels: labels,
                    datasets: [{
                        label: title,
                        data: data,
                        backgroundColor: type === 'doughnut' ? colors.slice(0, labels.length) : (data.map(v => v >= 0 ? '#10b981' : '#ef4444')),
                        borderColor: 'white',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: type === 'doughnut',
                            position: 'right',
                        },
                        title: {
                            display: false,
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    let label = context.dataset.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed.y !== undefined) {
                                        label += formatPercentage(context.parsed.y);
                                    } else {
                                        label += formatPercentage(context.parsed);
                                    }
                                    return label;
                                }
                            }
                        }
                    },
                    scales: options.scales || (type === 'doughnut' ? { y: { display: false }, x: { display: false } } : { y: { beginAtZero: true, title: { display: true, text: 'Percentage (%)' }, grid: { color: 'rgba(0, 0, 0, 0.05)' }, ticks: { callback: (value) => value + '%' } } })
                }
            });
        }

        function renderDashboardCharts() {
            const chartData = calculateChartData();
            const portfolio = appState.portfolio;
            
            if (portfolio.length === 0) {
                // Destroy existing charts to clear canvas if portfolio is empty
                Object.keys(dashboardCharts).forEach(key => {
                    if (dashboardCharts[key]) dashboardCharts[key].destroy();
                });
                return;
            }

            createChart('chart-cap-invested', 'doughnut', chartData.marketCap.labels, chartData.marketCap.invested, 'Market Cap Wise Invested (%)');
            createChart('chart-cap-profit', 'bar', chartData.marketCap.labels, chartData.marketCap.profit, 'Market Cap Wise %Profit (of Capital)', { scales: { y: { beginAtZero: false, title: { display: true, text: '% Profit' } } } });
            createChart('chart-cap-loss', 'bar', chartData.marketCap.labels, chartData.marketCap.loss.map(l => -l), 'Market Cap Wise %Loss (of Capital)', { scales: { y: { beginAtZero: true, title: { display: true, text: '% Loss' }, ticks: { callback: (value) => value + '%' } } } });

            createChart('chart-sector-invested', 'doughnut', chartData.sector.labels, chartData.sector.invested, 'Sector Wise Invested (%)');
            createChart('chart-sector-profit', 'bar', chartData.sector.labels, chartData.sector.profit, 'Sector Wise %Profit (of Capital)', { scales: { y: { beginAtZero: false, title: { display: true, text: '% Profit' } } } });
            createChart('chart-sector-loss', 'bar', chartData.sector.labels, chartData.sector.loss.map(l => -l), 'Sector Wise %Loss (of Capital)', { scales: { y: { beginAtZero: true, title: { display: true, text: '% Loss' }, ticks: { callback: (value) => value + '%' } } } });
        }
        
        function updateDashboardSummary() {
            const invested = parseFloat(document.getElementById('total-invested').textContent.replace(/[₹,]/g, '')) || 0;
            const current = parseFloat(document.getElementById('current-value').textContent.replace(/[₹,]/g, '')) || 0;
            const pnl = current - invested;
            const pnlPercent = (pnl / (invested || 1)) * 100;

            document.getElementById('dash-total-invested').textContent = formatCurrency(invested);
            document.getElementById('dash-current-value').textContent = formatCurrency(current);

            // Mocking Total Profit/Loss % of Capital (simplified for dashboard display)
            document.getElementById('dash-total-profit').textContent = pnlPercent >= 0 ? formatPercentage(pnlPercent) : '0.00%';
            document.getElementById('dash-total-loss').textContent = pnlPercent < 0 ? formatPercentage(Math.abs(pnlPercent)) : '0.00%';

            // Mocking Today's Profit/Loss %
            let todayPnL = 0;
            let todayChangePercentTotal = 0;
            appState.portfolio.forEach(stock => {
                const todayChange = stock.price - stock.previousClose;
                todayPnL += todayChange * stock.quantity;
            });
            const totalCurrentValueYesterday = appState.portfolio.reduce((sum, s) => sum + (s.previousClose * s.quantity), 0);
            const todayChangePercentOverall = (todayPnL / (totalCurrentValueYesterday || 1)) * 100;
            
            document.getElementById('dash-today-profit').textContent = todayChangePercentOverall >= 0 ? formatPercentage(todayChangePercentOverall) : '0.00%';
            document.getElementById('dash-today-loss').textContent = todayChangePercentOverall < 0 ? formatPercentage(Math.abs(todayChangePercentOverall)) : '0.00%';

            // XIRR is complex, mock as a simplified Annualized Return
            const daysAvg = appState.portfolio.length > 0 ? appState.portfolio.reduce((sum, s) => sum + calculateDaysHeld(s.buyDate, new Date().toISOString().split('T')[0]), 0) / appState.portfolio.length : 1;
            const annualizedReturn = pnlPercent * (365 / daysAvg);
            document.getElementById('dash-xirr').textContent = formatPercentage(annualizedReturn);
        }

        function updatePerformanceDistribution() {
            const portfolio = appState.portfolio;
            const counts = { 'p-25': 0, 'p-50': 0, 'p-75': 0, 'p-100': 0, 'p-200': 0, 'p-300': 0, 'p-500': 0, 'l-5': 0, 'l-10': 0, 'l-20': 0, 'l-25': 0, 'l-50': 0, 'l-75': 0, 'l-100': 0 };

            portfolio.forEach(stock => {
                const investment = stock.quantity * stock.buyPrice;
                const currentVal = stock.price * stock.quantity;
                const pnl = currentVal - investment;
                const pnlPercent = (pnl / investment) * 100;

                if (pnlPercent >= 25) counts['p-25']++;
                if (pnlPercent >= 50) counts['p-50']++;
                if (pnlPercent >= 75) counts['p-75']++;
                if (pnlPercent >= 100) counts['p-100']++;
                if (pnlPercent >= 200) counts['p-200']++;
                if (pnlPercent >= 300) counts['p-300']++;
                if (pnlPercent >= 500) counts['p-500']++;

                if (pnlPercent <= -5) counts['l-5']++;
                if (pnlPercent <= -10) counts['l-10']++;
                if (pnlPercent <= -20) counts['l-20']++;
                if (pnlPercent <= -25) counts['l-25']++;
                if (pnlPercent <= -50) counts['l-50']++;
                if (pnlPercent <= -75) counts['l-75']++;
                if (pnlPercent <= -100) counts['l-100']++;
            });

            for (const key in counts) {
                document.getElementById(`count-${key}`).textContent = counts[key];
            }
        }

        function updateMarketPrediction() {
            const portfolio = appState.portfolio;
            const totalPnLPercent = appState.portfolio.reduce((sum, s) => {
                const investment = s.quantity * s.buyPrice;
                const currentVal = s.price * s.quantity;
                const pnl = currentVal - investment;
                return sum + (pnl / investment) * 100;
            }, 0);
            const avgPnl = totalPnLPercent / (portfolio.length || 1);

            const predictionEl = document.getElementById('market-prediction');
            let trend = 'Neutral';
            let color = '#667eea';

            if (portfolio.length === 0) {
                trend = 'No Data';
                color = '#9ca3af';
            } else if (avgPnl > 15 && portfolio.length > 3) {
                trend = 'Bullish 🚀';
                color = '#10b981';
            } else if (avgPnl < -5 && portfolio.length > 3) {
                trend = 'Bearish 📉';
                color = '#ef4444';
            } else if (avgPnl > 5) {
                trend = 'Slightly Bullish ⬆️';
                color = '#f59e0b';
            }

            predictionEl.textContent = trend;
            predictionEl.style.color = color;
        }

        function updateDashboard() {
            renderPortfolioTable();
            updateDashboardSummary();
            renderDashboardCharts();
            updatePerformanceDistribution();
            updateMarketPrediction();
        }


        // =============================================================================
        // WATCHLIST MANAGEMENT
        // =============================================================================
        async function addToWatchlist() {
            const symbol = document.getElementById('watchlist-ticker').value.toUpperCase().trim();
            const entryDate = document.getElementById('watchlist-entry-date').value;
            const breakoutPrice = parseFloat(document.getElementById('watchlist-breakout-price').value) || 0;
            const macdSettings = getCheckedValues('macd');
            const emaSettings = getCheckedValues('ema');
            
            if (!symbol || !entryDate) {
                showNotification('Please enter Ticker and Entry Date.', true);
                return;
            }

            const existingIndex = appState.watchlist.findIndex(s => s.symbol === symbol);
            if (existingIndex !== -1) {
                showNotification(`Stock ${symbol} is already in your watchlist.`, true);
                return;
            }

            const apiData = await fetchStockPrice(symbol);

            const watchlistEntry = {
                symbol,
                entryDate,
                breakoutPrice,
                macd: macdSettings,
                ema: emaSettings,
                price: apiData.price,
                historic: apiData.historic,
            };

            appState.watchlist.push(watchlistEntry);
            saveToLocalStorage();
            renderWatchlistTable();
            showNotification(`Stock ${symbol} added to watchlist!`);
        }

        function deleteWatchlistStock(index) {
            const stock = appState.watchlist[index];
            if (confirm(`Are you sure you want to remove ${stock.symbol} from your watchlist?`)) {
                appState.watchlist.splice(index, 1);
                saveToLocalStorage();
                renderWatchlistTable();
                showNotification(`Stock ${stock.symbol} removed from watchlist.`);
            }
        }

        async function refreshWatchlistPrices() {
            showNotification('Refreshing all watchlist prices...');
            const fetchPromises = appState.watchlist.map(stock => fetchStockPrice(stock.symbol));
            const results = await Promise.all(fetchPromises);
            
            results.forEach((data, index) => {
                const stock = appState.watchlist[index];
                if (data.success || appState.apiStatus === 'offline') {
                    stock.price = data.price;
                    stock.historic = data.historic;
                }
            });

            saveToLocalStorage();
            renderWatchlistTable();
            showNotification('Watchlist prices updated!');
        }

        function renderWatchlistTable() {
            const tbody = document.getElementById('watchlist-tbody');
            let html = '';

            if (appState.watchlist.length === 0) {
                tbody.innerHTML = '<tr><td colspan="19" class="neutral" style="text-align: center;">No stocks in watchlist. Add a new stock above.</td></tr>';
                return;
            }

            appState.watchlist.forEach((stock, i) => {
                const cmp = stock.price;
                const breakoutRefPrice = stock.breakoutPrice > 0 ? stock.breakoutPrice : stock.price; // Use CMP if Breakout is not set for P&L calculation
                const pnlChange = breakoutRefPrice > 0 ? ((cmp - breakoutRefPrice) / breakoutRefPrice) * 100 : 0;
                
                // Mock historical data structure for rendering
                const historic = stock.historic || { 
                    price3d: 0, price1w: 0, price24d: 0,
                    volume3d: 0, volume1w: 0, volume24d: 0,
                };


                html += `
                    <tr>
                        <td>${stock.entryDate}</td>
                        <td>${stock.symbol}</td>
                        <td class="${getPnLClass(historic.price3d)}">${formatPercentage(historic.price3d)}</td>
                        <td class="${getPnLClass(historic.price1w)}">${formatPercentage(historic.price1w)}</td>
                        <td class="${getPnLClass(historic.price24d)}">${formatPercentage(historic.price24d)}</td>
                        <td>${formatCurrency(cmp)}</td>
                        <td>${formatCurrency(stock.breakoutPrice)}</td>
                        <td class="${getPnLClass(pnlChange)}">${formatPercentage(pnlChange)}</td>
                        <td>${formatPercentage(historic.volume3d)}</td>
                        <td>${formatPercentage(historic.volume1w)}</td>
                        <td>${formatPercentage(historic.volume24d)}</td>
                        <td>${renderCheckboxStatus(stock, 'macd', 'A')}</td>
                        <td>${renderCheckboxStatus(stock, 'macd', 'S')}</td>
                        <td>${renderCheckboxStatus(stock, 'macd', 'Q')}</td>
                        <td>${renderCheckboxStatus(stock, 'macd', 'M')}</td>
                        <td>${renderCheckboxStatus(stock, 'macd', 'W')}</td>
                        <td>${renderCheckboxStatus(stock, 'ema', 'M')}</td>
                        <td>${renderCheckboxStatus(stock, 'ema', 'W')}</td>
                        <td>${renderCheckboxStatus(stock, 'ema', 'D')}</td>
                        <td>${renderCheckboxStatus(stock, 'ema', '3h')}</td>
                        <td>${renderCheckboxStatus(stock, 'ema', '1h')}</td>
                        <td class="action-buttons">
                            <button class="btn btn-danger btn-small" onclick="deleteWatchlistStock(${i})">Remove</button>
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }


        // =============================================================================
        // FUNDAMENTAL ANALYSIS (MOCK) - REWRITTEN
        // =============================================================================

        // Function to save user criteria for a specific market cap to appState
        function saveUserCriteria() {
            const marketCap = document.getElementById('fundamental-marketcap').value;
            // Only save the editable fields (which exist only in 'User' mode)
            const inputs = document.querySelectorAll('#fundamental-tbody input[data-param-name]');
            
            appState.userFundamentalCriteria[marketCap] = appState.userFundamentalCriteria[marketCap] || {};
            
            inputs.forEach(input => {
                const paramName = input.getAttribute('data-param-name');
                const newValue = input.value.trim();
                appState.userFundamentalCriteria[marketCap][paramName] = newValue;
            });

            saveAppState();
        }


        function renderFundamentalCriteriaTable() {
            // Ensure any unsaved user changes are captured before re-rendering
            // This is mainly for saving when switching tabs, not modes. 
            // Saving when toggling mode is handled in toggleCriteriaMode.

            const marketCap = document.getElementById('fundamental-marketcap').value;
            const tbody = document.getElementById('fundamental-tbody');
            
            // Combine base criteria with user custom criteria
            const criteriaList = fundamentalCriteria.map(c => ({...c, isCustom: false})).concat(
                appState.customFundamentalCriteria.map((c, i) => ({...c, isCustom: true, customIndex: i}))
            );

            let html = '';

            if (appState.editingCriteriaId && appState.criteriaMode === 'User') {
                document.getElementById('save-default-btn').style.display = 'inline-block';
            } else {
                 document.getElementById('save-default-btn').style.display = 'none';
            }


            criteriaList.forEach((criteria, index) => {
                const isCustomRow = criteria.isCustom;
                const rowIndex = isCustomRow ? `custom-${criteria.customIndex}` : `base-${index}`;
                const isEditing = appState.editingCriteriaId === rowIndex;

                // 1. Determine Index Set Value: User > MarketCapDefaults > Base
                let indexSetValue = criteria.baseValue;
                const criteriaName = criteria.name;
                
                // Check User Overrides first
                if (appState.userFundamentalCriteria[marketCap] && appState.userFundamentalCriteria[marketCap][criteriaName]) {
                    indexSetValue = appState.userFundamentalCriteria[marketCap][criteriaName];
                } else {
                    // Check Market Cap Defaults
                    if (marketCapDefaults[marketCap] && marketCapDefaults[marketCap][criteriaName]) {
                        indexSetValue = marketCapDefaults[marketCap][criteriaName];
                    } else if (marketCapDefaults[marketCap] && marketCapDefaults[marketCap][criteriaName + ' ' + criteria.operator]) {
                         // Fallback for criteria with explicit operator in the key
                        indexSetValue = marketCapDefaults[marketCap][criteriaName + ' ' + criteria.operator];
                    }
                }

                // 2. Render Index Set Value as input or text
                let indexSetValueCell;
                if (appState.criteriaMode === 'User' && !isEditing) {
                    // Editable box for Index Set Value when in 'User' mode
                    indexSetValueCell = `<td>
                        <input type="text" class="form-control" value="${indexSetValue}" data-param-name="${criteriaName}" onchange="saveUserCriteria()">
                    </td>`;
                } else {
                    // Non-editable freeze box for 'Default' mode or when editing name/operator
                    indexSetValueCell = `<td><span class="neutral" style="font-weight: 500;">${indexSetValue}</span></td>`;
                }

                // 3. Mock logic for Company Value and Score (unchanged)
                let companyValue = (Math.random() * 100).toFixed(2);
                let score = 'N/A';
                
                if (!isNaN(parseFloat(indexSetValue.replace(/[%,]/g, '')))) {
                    const indexValueNum = parseFloat(indexSetValue.replace(/[%,]/g, ''));
                    const companyValueNum = parseFloat(companyValue);
                    let isPass = false;

                    if (criteria.operator === '<' && companyValueNum < indexValueNum) isPass = true;
                    if (criteria.operator === '>' && companyValueNum > indexValueNum) isPass = true;
                    if (criteria.operator === '=' && companyValueNum === indexValueNum) isPass = true;
                    
                    score = isPass ? 'Pass' : 'Fail';
                    companyValue = isPass ? `<span class="positive">${companyValue}</span>` : `<span class="negative">${companyValue}</span>`;
                    score = isPass ? `<span class="positive">Pass</span>` : `<span class="negative">Fail</span>`;
                }

                // 4. Actions buttons (Edit/Remove/Save)
                let actionsHtml = '';
                if (isEditing) {
                     actionsHtml = `
                        <button class="btn btn-success btn-small" onclick="saveFundamentalCriteria('${rowIndex}', ${isCustomRow})">Save</button>
                        <button class="btn btn-warning btn-small" onclick="editFundamentalCriteria('none')">Cancel</button>
                     `;
                } else if (isCustomRow) {
                    actionsHtml = `
                        <button class="btn btn-warning btn-small" onclick="editFundamentalCriteria('${rowIndex}', true)">Edit</button>
                        <button class="btn btn-danger btn-small" onclick="removeFundamentalCriteria(${criteria.customIndex})">Remove</button>
                    `;
                } else {
                    actionsHtml = `<button class="btn btn-small" disabled>Base</button>`;
                }
                
                let paramCell = `<td>${criteria.name}</td>`;
                let operatorCell = `<td>${criteria.operator}</td>`;

                if (isEditing) {
                     paramCell = `<td><input type="text" id="edit-param-name" class="form-control" value="${criteria.name}"></td>`;
                     operatorCell = `<td><select id="edit-param-op" class="form-control"><option value="<" ${criteria.operator === '<' ? 'selected' : ''}>&lt;</option><option value=">" ${criteria.operator === '>' ? 'selected' : ''}>&gt;</option><option value="=" ${criteria.operator === '=' ? 'selected' : ''}>=</option></select></td>`;
                }


                html += `
                    <tr id="row-${rowIndex}">
                        ${paramCell}
                        ${operatorCell}
                        ${indexSetValueCell}
                        <td>${companyValue}</td>
                        <td>${score}</td>
                        <td>${indexSetValue.includes('back') ? 'Requires historic data comparison' : 'Standard check'}</td>
                        <td>${actionsHtml}</td>
                    </tr>
                `;
            });

            tbody.innerHTML = html;
        }

        // Function to switch between Default and User criteria modes
        function toggleCriteriaMode(mode) {
            if (appState.criteriaMode === 'User' && mode === 'Default') {
                // Save inputs if switching from User to Default
                saveUserCriteria(); 
            }
            appState.criteriaMode = mode;
            const saveBtn = document.getElementById('save-default-btn');
            
            if (mode === 'User') {
                saveBtn.style.display = 'inline-block';
            } else {
                saveBtn.style.display = 'none';
            }
            
            // Clear any active editing state when changing mode
            appState.editingCriteriaId = null;
            
            // Re-render the table with the new mode
            renderFundamentalCriteriaTable();
        }

        // Function to save user criteria as the new default for the selected market cap
        function saveUserCriteriaAsDefault() {
            const marketCap = document.getElementById('fundamental-marketcap').value;
            
            // 1. Ensure all current user inputs in the table are saved to appState.userFundamentalCriteria
            saveUserCriteria(); 
            
            // 2. Transfer user values to marketCapDefaults (Only updating the in-memory/session default)
            const userValues = appState.userFundamentalCriteria[marketCap] || {};
            for (const key in userValues) {
                // For demonstration, we directly update the mock defaults in-memory
                marketCapDefaults[marketCap][key] = userValues[key];
            }

            showNotification(`User values saved as the new temporary Default for ${marketCap}! Switch to 'Default' mode to view changes.`, false);
        }

        // Function to add a new fundamental criteria row
        function addNewFundamentalCriteria() {
            const newCriteria = {
                name: 'New Parameter',
                operator: '>',
                baseValue: '0',
                isCustom: true,
                tempNew: true
            };
            appState.customFundamentalCriteria.push(newCriteria);
            saveAppState();
            
            // Set criteria mode to User and start editing the newly added row
            if (appState.criteriaMode !== 'User') {
                 document.querySelector('input[name="criteria-mode"][value="User"]').checked = true;
                 appState.criteriaMode = 'User';
            }
            appState.editingCriteriaId = `custom-${appState.customFundamentalCriteria.length - 1}`;
            
            renderFundamentalCriteriaTable();
            showNotification('New parameter added. Edit the name/operator and click Save.', false);
        }

        // Function to put a row into an editing state for Parameter/Operator
        function editFundamentalCriteria(id) {
            if (id === 'none') {
                appState.editingCriteriaId = null;
            } else {
                appState.editingCriteriaId = id;
            }
            renderFundamentalCriteriaTable();
        }

        // Function to save the edited Parameter/Operator
        function saveFundamentalCriteria(id) {
            const newName = document.getElementById('edit-param-name').value;
            const newOp = document.getElementById('edit-param-op').value;
            
            if (!newName.trim()) {
                showNotification('Parameter name cannot be empty.', true);
                return;
            }

            const index = parseInt(id.split('-')[1]);
            
            if (id.startsWith('custom-') && index >= 0 && index < appState.customFundamentalCriteria.length) {
                appState.customFundamentalCriteria[index].name = newName;
                appState.customFundamentalCriteria[index].operator = newOp;
                saveAppState();
                showNotification('Parameter name and operator updated.', false);
            }
            
            appState.editingCriteriaId = null;
            renderFundamentalCriteriaTable();
        }

        // Function to remove a fundamental criteria row
        function removeFundamentalCriteria(index) {
            if (confirm('Are you sure you want to remove this custom parameter?')) {
                appState.customFundamentalCriteria.splice(index, 1);
                saveAppState();
                renderFundamentalCriteriaTable();
                showNotification('Custom parameter removed.', false);
            }
        }


        function analyzeFundamental() {
            const ticker = document.getElementById('fundamental-ticker').value.toUpperCase().trim();
            if (!ticker) {
                showNotification('Please enter a Ticker Symbol to analyze.', true);
                return;
            }
            showNotification(`Running fundamental analysis for ${ticker}... (In a real app, this would be an API call)`);
            
            // The table mock-updates on its own when re-rendered, simulating analysis.
            renderFundamentalCriteriaTable();
        }


        // =============================================================================
        // ALERTS TAB
        // =============================================================================
        function addAlert() {
            const ticker = document.getElementById('alert-ticker').value.toUpperCase().trim();
            const condition = document.getElementById('alert-condition').value;
            const price = parseFloat(document.getElementById('alert-price').value);

            if (!ticker || isNaN(price) || price <= 0) {
                showNotification('Please enter a valid Ticker and Target Price.', true);
                return;
            }

            const alertEntry = {
                ticker,
                condition,
                price,
                status: 'Active',
            };

            appState.alerts.push(alertEntry);
            saveToLocalStorage();
            renderAlerts();
            showNotification(`Alert set for ${ticker} ${condition} ${formatCurrency(price)}.`);
        }

        function deleteAlert(index) {
             const alertEntry = appState.alerts[index];
            if (confirm(`Are you sure you want to delete the alert for ${alertEntry.ticker} at ${alertEntry.condition} ${formatCurrency(alertEntry.price)}?`)) {
                appState.alerts.splice(index, 1);
                saveToLocalStorage();
                renderAlerts();
                showNotification(`Alert for ${alertEntry.ticker} deleted.`);
            }
        }

        async function checkAlerts() {
            if (appState.alerts.length === 0) return;
            showNotification('Checking live prices for alerts...');

            const tickers = [...new Set(appState.alerts.map(a => a.ticker))];
            const priceData = {};

            const fetchPromises = tickers.map(ticker => fetchStockPrice(ticker).then(data => {
                priceData[ticker] = data.price;
            }));

            await Promise.all(fetchPromises);

            appState.alerts.forEach(alert => {
                const currentPrice = priceData[alert.ticker];
                let status = 'Active';

                if (currentPrice !== undefined) {
                    if (alert.condition === 'above' && currentPrice >= alert.price) {
                        status = 'Triggered (Above)';
                        showNotification(`${alert.ticker} alert triggered! Current Price: ${formatCurrency(currentPrice)}`, false);
                    } else if (alert.condition === 'below' && currentPrice <= alert.price) {
                        status = 'Triggered (Below)';
                        showNotification(`${alert.ticker} alert triggered! Current Price: ${formatCurrency(currentPrice)}`, false);
                    }
                } else {
                    status = 'Price Unavailable';
                }
                alert.status = status;
            });

            renderAlerts();
            saveToLocalStorage();
        }

        function renderAlerts() {
            const tbody = document.getElementById('alerts-tbody');
            let html = '';

            if (appState.alerts.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="neutral" style="text-align: center;">No active price alerts set.</td></tr>';
                return;
            }

            appState.alerts.forEach((alert, i) => {
                // Mock Current Price (using a quick fetch, or fallback)
                // In a real app, this price would be stored/refreshed in a central location
                const mockPrice = alert.price * (1 + (Math.random() - 0.5) * 0.1);
                let statusClass = 'neutral';
                if (alert.status.includes('Triggered')) statusClass = 'positive';
                if (alert.status.includes('Unavailable')) statusClass = 'negative';

                html += `
                    <tr>
                        <td>${alert.ticker}</td>
                        <td>${alert.condition}</td>
                        <td>${formatCurrency(alert.price)}</td>
                        <td>${formatCurrency(mockPrice)}</td>
                        <td class="${statusClass}">${alert.status}</td>
                        <td class="action-buttons">
                            <button class="btn btn-danger btn-small" onclick="deleteAlert(${i})">Delete</button>
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }

        // =============================================================================
        // MARKET TAB
        // =============================================================================
        const MARKET_INDICES = [
            { label: 'Nifty 50', yahooSymbol: '%5ENSEI' },
            { label: 'Sensex', yahooSymbol: '%5EBSESN' },
            { label: 'Bank Nifty', yahooSymbol: '%5ENSEBANK' },
            { label: 'India VIX', yahooSymbol: '%5EINDIAVIX' },
        ];

        async function fetchIndexQuote(yahooSymbol) {
            const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=5d`;
            const data = await fetchWithProxies(yahooUrl);
            const result = data && data.chart && data.chart.result && data.chart.result[0];
            if (!result || !result.meta || typeof result.meta.regularMarketPrice !== 'number') {
                throw new Error('No index data');
            }
            const price = result.meta.regularMarketPrice;
            const prevClose = result.meta.previousClose || result.meta.chartPreviousClose || price;
            const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
            return { price, changePercent };
        }

        function renderIndexCard(label, price, changePercent, isPositive) {
            const bg = isPositive
                ? 'green'
                : 'style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);"';
            const cls = isPositive ? 'green' : '';
            const style = isPositive ? '' : 'style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);"';
            const changeClass = isPositive ? 'positive' : 'negative';
            const sign = isPositive ? '+' : '';
            return `
                <div class="summary-card ${cls}" ${style}>
                    <div class="summary-title">${label}</div>
                    <div class="summary-value">${price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                    <div class="summary-change ${changeClass}">${sign}${changePercent.toFixed(2)}%</div>
                </div>
            `;
        }

        async function loadMarketOverview() {
            const container = document.getElementById('market-indices');
            container.innerHTML = '<div class="summary-card"><div class="summary-title">Loading market data…</div></div>';

            const results = await Promise.all(
                MARKET_INDICES.map(async (idx) => {
                    try {
                        const q = await fetchIndexQuote(idx.yahooSymbol);
                        return { label: idx.label, price: q.price, changePercent: q.changePercent, live: true };
                    } catch (error) {
                        console.warn(`Index fetch failed for ${idx.label}, using placeholder:`, error.message);
                        return { label: idx.label, price: 0, changePercent: 0, live: false };
                    }
                })
            );

            const anyLive = results.some(r => r.live);
            const heading = document.querySelector('#market .card h2');
            if (heading) {
                heading.textContent = anyLive ? 'Market Overview (~15 min delayed)' : 'Market Overview (data unavailable)';
            }

            container.innerHTML = results.map(r =>
                r.live
                    ? renderIndexCard(r.label, r.price, r.changePercent, r.changePercent >= 0)
                    : `<div class="summary-card" style="background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);">
                         <div class="summary-title">${r.label}</div>
                         <div class="summary-value">—</div>
                         <div class="summary-change neutral">unavailable</div>
                       </div>`
            ).join('');
        }


        // =============================================================================
        // INITIALIZATION
        // =============================================================================
        
        document.addEventListener('DOMContentLoaded', async () => {
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('buy-date').value = today;
            document.getElementById('watchlist-entry-date').value = today;

            // Set up cross-device sync (no-ops safely if not configured)
            initFirebase();
            wireSyncControls();

            // Load any previously saved data before rendering
            await loadAppState();

            // Load initial data
            loadPortfolio();
            updateApiStatus();
            renderAlerts();
            
            // Initialize the Fundamental Analysis tab criteria
            renderFundamentalCriteriaTable(); 
        });

        function wireSyncControls() {
            const linkBtn = document.getElementById('sync-link-btn');
            const codeInput = document.getElementById('sync-code-input');
            if (!linkBtn || !codeInput) return;

            if (syncCode) codeInput.value = syncCode;

            linkBtn.addEventListener('click', async () => {
                const code = codeInput.value.trim();
                if (!code) {
                    showNotification('Enter a sync code first (make one up, e.g. "raj-portfolio-2026").', true);
                    return;
                }
                const pull = confirm(
                    'Click OK to PULL data already saved under this code (use on a new device).\n' +
                    'Click Cancel to PUSH this device\'s current data to that code (use on your first/main device).'
                );
                await setSyncCode(code, pull ? 'pull' : 'push');
                showNotification(pull ? 'Synced: pulled data from cloud.' : 'Synced: pushed data to cloud.');
            });
        }

