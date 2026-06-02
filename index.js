// index.js - UseMyCash API for Render deployment
const express = require('express');
const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS for Adalo
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// AUD denominations in cents (largest to smallest)
const AUD_DENOMS = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5];
const AUD_LABELS = ['note100', 'note50', 'note20', 'note10', 'note5', 'coin2dollar', 'coin1dollar', 'coin50cent', 'coin20cent', 'coin10cent', 'coin5cent'];
const AUD_NAMES  = ['$100 note', '$50 note', '$20 note', '$10 note', '$5 note', '$2 coin', '$1 coin', '50 cent coin', '20 cent coin', '10 cent coin', '5 cent coin'];

// Format cents as dollar string e.g. 2397 -> "$23.97"
function formatDollars(cents) {
  return '$' + (cents / 100).toFixed(2);
}

// Round purchase amount up to nearest 5 cents (AUD cash rounding)
function roundToNearest5(cents) {
  return Math.round(cents / 5) * 5;
}

// Bounded dynamic programming change making algorithm
function boundedChangemaking(targetCents, denomsCents, quantities) {
  const n = denomsCents.length;

  // Check total available cash
  let totalAvailable = 0;
  for (let i = 0; i < n; i++) {
    totalAvailable += denomsCents[i] * quantities[i];
  }

  if (totalAvailable < targetCents) {
    return { success: false, notEnoughCash: true };
  }

  // Find minimum overpayment amount we can make
  // Try exact first, then increments of 5 cents up to totalAvailable
  for (let target = targetCents; target <= totalAvailable; target += 5) {
    const result = tryMakeAmount(target, denomsCents, quantities, n);
    if (result) {
      return {
        success: true,
        notEnoughCash: false,
        amountPaid: target,
        usedCounts: result
      };
    }
  }

  return { success: false, notEnoughCash: false };
}

// Try to make exact amount using dynamic programming
function tryMakeAmount(target, denomsCents, quantities, n) {
  // dp[i] = minimum number of denominations to make amount i
  // prev[i] = which denomination index was used to reach amount i
  const dp = new Array(target + 1).fill(Infinity);
  const prev = new Array(target + 1).fill(-1);
  const prevCount = new Array(target + 1).fill(0);
  dp[0] = 0;

  // Track how many of each denomination used at each amount
  // Use bounded knapsack approach
  const used = Array.from({ length: target + 1 }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    const denom = denomsCents[i];
    const maxQty = quantities[i];

    // Process from high to low to handle bounded quantities
    for (let amt = target; amt >= denom; amt--) {
      for (let qty = 1; qty <= maxQty; qty++) {
        if (amt - denom * qty < 0) break;
        const prev_amt = amt - denom * qty;
        if (dp[prev_amt] !== Infinity && dp[prev_amt] + qty < dp[amt]) {
          dp[amt] = dp[prev_amt] + qty;
          used[amt] = [...used[prev_amt]];
          used[amt][i] = qty;
        }
      }
    }
  }

  if (dp[target] === Infinity) return null;
  return used[target];
}

// Main change making endpoint
// Route: /api/makechange/:amount/:currency/:wallet
// wallet = comma separated quantities matching AUD_LABELS order
// e.g. /api/makechange/23.97/AUD/2,1,3,2,1,3,2,4,5,3,2
app.get('/api/makechange/:amount/:currency/:wallet', (req, res) => {
  const { amount, currency, wallet } = req.params;

  // Validate amount
  const dollars = parseFloat(amount);
  if (isNaN(dollars) || dollars <= 0) {
    return res.status(400).json([{
      success: false,
      errorMessage: 'Invalid amount. Must be a positive number.',
      message: 'Invalid amount entered.'
    }]);
  }

  // Convert dollars to cents and apply AUD cash rounding
  const rawCents = Math.round(dollars * 100);
  const totalCents = roundToNearest5(rawCents);

  // Parse wallet quantities
  const walletQtys = wallet.split(',').map(q => parseInt(q) || 0);

  // Validate wallet has 11 values
  if (walletQtys.length !== 11) {
    return res.status(400).json([{
      success: false,
      errorMessage: 'Invalid wallet format. Expected 11 comma separated values.',
      message: 'Wallet data is invalid.'
    }]);
  }

  // Run bounded change making algorithm
  const result = boundedChangemaking(totalCents, AUD_DENOMS, walletQtys);

  // Not enough cash
  if (result.notEnoughCash) {
    return res.status(200).json([{
      success: false,
      notEnoughCash: true,
      amount: totalCents,
      currency: currency.toUpperCase(),
      note100: 0, note50: 0, note20: 0, note10: 0, note5: 0,
      coin2dollar: 0, coin1dollar: 0, coin50cent: 0, coin20cent: 0, coin10cent: 0, coin5cent: 0,
      amountPaid: 0,
      changeOwed: 0,
      totalDenominations: 0,
      breakdown: '',
      message: `You don't have enough cash for this purchase of ${formatDollars(totalCents)}.`,
      errorMessage: 'Not enough cash'
    }]);
  }

  // No solution found (shouldn't happen if notEnoughCash check passes)
  if (!result.success) {
    return res.status(200).json([{
      success: false,
      notEnoughCash: false,
      amount: totalCents,
      currency: currency.toUpperCase(),
      note100: 0, note50: 0, note20: 0, note10: 0, note5: 0,
      coin2dollar: 0, coin1dollar: 0, coin50cent: 0, coin20cent: 0, coin10cent: 0, coin5cent: 0,
      amountPaid: 0,
      changeOwed: 0,
      totalDenominations: 0,
      breakdown: ' ',
      message: 'Unable to make this amount with your current wallet.',
      errorMessage: 'No solution found'
    }]);
  }

  // Build response
  const usedCounts = result.usedCounts;
  const amountPaid = result.amountPaid;
  const changeOwed = amountPaid - totalCents;
  const exactChange = changeOwed === 0;
  let totalDenominations = 0;
  const coins = {};

  // Build breakdown text
  const breakdownParts = [];
  const speechParts = [];

  for (let i = 0; i < AUD_LABELS.length; i++) {
    const qty = usedCounts[i];
    coins[AUD_LABELS[i]] = qty;
    if (qty > 0) {
      totalDenominations += qty;
      breakdownParts.push(`${qty} x ${AUD_NAMES[i]}`);
      speechParts.push(`${qty} ${AUD_NAMES[i]}${qty > 1 ? 's' : ''}`);
    }
  }

  const breakdown = breakdownParts.join(', ');

  // Build spoken message
  let message = `For a purchase of ${formatDollars(totalCents)}, hand over ${speechParts.join(', and ')}.`;
  if (!exactChange) {
    message += ` You will receive ${formatDollars(changeOwed)} change.`;
  } else {
    message += ` That is exact change.`;
  }

  // Build change owed message
  const changeMessage = exactChange
    ? 'Exact change — no change required.'
    : `Change to receive: ${formatDollars(changeOwed)}`;

  return res.status(200).json([{
    success: true,
    notEnoughCash: false,
    amount: totalCents,
    currency: currency.toUpperCase(),
    ...coins,
    amountPaid,
    changeOwed,
    exactChange,
    totalDenominations,
    breakdown,
    message,
    changeMessage,
    errorMessage: ''
  }]);
});

// Keep original endpoint for backward compatibility (no wallet)
app.get('/api/makechange/:amount/:currency', (req, res) => {
  const { amount, currency = 'AUD' } = req.params;
  const dollars = parseFloat(amount);
  if (isNaN(dollars) || dollars <= 0) {
    return res.status(400).json([{ error: 'Invalid amount.' }]);
  }
  const totalCents = roundToNearest5(Math.round(dollars * 100));
  const denomsCents = AUD_DENOMS;
  const unlimitedQtys = new Array(11).fill(999);
  const result = boundedChangemaking(totalCents, denomsCents, unlimitedQtys);
  const coins = {};
  let totalDenominations = 0;
  const breakdownParts = [];
  for (let i = 0; i < AUD_LABELS.length; i++) {
    const qty = result.usedCounts[i];
    coins[AUD_LABELS[i]] = qty;
    if (qty > 0) {
      totalDenominations += qty;
      breakdownParts.push(`${qty} x ${AUD_NAMES[i]}`);
    }
  }
  return res.status(200).json([{
    amount: totalCents,
    currency: currency.toUpperCase(),
    ...coins,
    totalDenominations,
    breakdown: breakdownParts.join(', ')
  }]);
});

// Speech page endpoint
// Route: /speak/:text
app.get('/speak/:text', (req, res) => {
  const text = decodeURIComponent(req.params.text);
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UseMyCash</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f5f5f5;
      padding: 20px;
      box-sizing: border-box;
    }
    .message {
      font-size: 18px;
      text-align: center;
      color: #333;
      margin-bottom: 30px;
      line-height: 1.5;
    }
    .btn {
      background: #007AFF;
      color: white;
      border: none;
      border-radius: 12px;
      padding: 16px 32px;
      font-size: 18px;
      cursor: pointer;
      width: 100%;
      max-width: 300px;
    }
    .btn:active {
      background: #0056b3;
    }
  </style>
</head>
<body>
  <div class="message">${text}</div>
  <button class="button" onclick="speak()">🔊 Read Aloud</button>
  <script>
    function speak() {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(${JSON.stringify(text)});
        msg.lang = 'en-AU';
        msg.rate = 0.9;
        msg.pitch = 1.2;
        msg.volume = 1.0;

        // Wait for voices to load then select preferred voice
        function selectVoice() {
          const voices = window.speechSynthesis.getVoices();

          // Priority order of preferred Australian/English female voices on iOS
          const preferred = [
            'Karen',        // iOS Australian English female (best option)
            'Catherine',    // iOS Australian English female alternative
            'Samantha',     // iOS US English female fallback
            'Moira',        // iOS Irish English female fallback
            'Veena',        // iOS Indian English female fallback
          ];

          let selectedVoice = null;

          // Try preferred voices first
          for (const name of preferred) {
            const found = voices.find(v => v.name.includes(name));
            if (found) {
              selectedVoice = found;
              break;
            }
          }

          // Fall back to any English female voice
          if (!selectedVoice) {
            selectedVoice = voices.find(v =>
              v.lang.startsWith('en') && v.name.toLowerCase().includes('female')
            );
          }

          // Fall back to any English voice
          if (!selectedVoice) {
            selectedVoice = voices.find(v => v.lang.startsWith('en'));
          }

          if (selectedVoice) msg.voice = selectedVoice;
          window.speechSynthesis.speak(msg);
        }

        // iOS requires a small delay for voices to load
        if (window.speechSynthesis.getVoices().length > 0) {
          selectVoice();
        } else {
          window.speechSynthesis.onvoiceschanged = selectVoice;
        }
      }
    }
    // Auto speak on load
    window.addEventListener('load', () => {
      setTimeout(speak, 500);
    });
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`UseMyCash API running on port ${PORT}`);
});
