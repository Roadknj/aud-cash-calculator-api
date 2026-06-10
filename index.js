// index.js - UseMyCash API v26
const express = require('express');
const app = express();
const PORT = process.env.PORT || 4000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

const AUD_DENOMS = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5];
const AUD_LABELS = ['note100', 'note50', 'note20', 'note10', 'note5', 'coin2dollar', 'coin1dollar', 'coin50cent', 'coin20cent', 'coin10cent', 'coin5cent'];
const AUD_NAMES  = ['$100 note', '$50 note', '$20 note', '$10 note', '$5 note', '$2 coin', '$1 coin', '50 cent coin', '20 cent coin', '10 cent coin', '5 cent coin'];

function formatDollars(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function roundToNearest5(cents) {
  return Math.round(cents / 5) * 5;
}

function tryMakeAmount(target, denomsCents, quantities, n) {
  const dp = new Array(target + 1).fill(Infinity);
  dp[0] = 0;
  const used = Array.from({ length: target + 1 }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    const denom = denomsCents[i];
    const maxQty = quantities[i];
    for (let amt = target; amt >= denom; amt--) {
      for (let qty = 1; qty <= maxQty; qty++) {
        if (amt - denom * qty < 0) break;
        const prevAmt = amt - denom * qty;
        if (dp[prevAmt] !== Infinity && dp[prevAmt] + qty < dp[amt]) {
          dp[amt] = dp[prevAmt] + qty;
          used[amt] = [...used[prevAmt]];
          used[amt][i] = qty;
        }
      }
    }
  }
  if (dp[target] === Infinity) return null;
  return used[target];
}

function boundedChangeMaking(targetCents, denomsCents, quantities) {
  const n = denomsCents.length;
  let totalAvailable = 0;
  for (let i = 0; i < n; i++) totalAvailable += denomsCents[i] * quantities[i];
  if (totalAvailable < targetCents) return { success: false, notEnoughCash: true };
  for (let target = targetCents; target <= totalAvailable; target += 5) {
    const result = tryMakeAmount(target, denomsCents, quantities, n);
    if (result) return { success: true, notEnoughCash: false, amountPaid: target, usedCounts: result };
  }
  return { success: false, notEnoughCash: false };
}

// Speech page
app.get('/speak/:text', (req, res) => {
  const text = decodeURIComponent(req.params.text);
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UseMyCash</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; padding: 20px; box-sizing: border-box; }
    .message { font-size: 18px; text-align: center; color: #333; margin-bottom: 30px; line-height: 1.5; }
    .btn { background: #007AFF; color: white; border: none; border-radius: 12px; padding: 16px 32px; font-size: 18px; cursor: pointer; width: 100%; max-width: 300px; }
    .btn:active { background: #0056b3; }
  </style>
</head>
<body>
  <div class="message">${text}</div>
  <button class="btn" onclick="speak()">🔊 Read Aloud</button>
  <script>
    function speak() {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(${JSON.stringify(text)});
        msg.lang = 'en-AU'; msg.rate = 0.9; msg.pitch = 1.2; msg.volume = 1.0;
        function selectVoice() {
          const voices = window.speechSynthesis.getVoices();
          const preferred = ['Karen', 'Catherine', 'Samantha', 'Moira', 'Veena'];
          let sel = null;
          for (const name of preferred) { const f = voices.find(v => v.name.includes(name)); if (f) { sel = f; break; } }
          if (!sel) sel = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'));
          if (!sel) sel = voices.find(v => v.lang.startsWith('en'));
          if (sel) msg.voice = sel;
          window.speechSynthesis.speak(msg);
        }
        if (window.speechSynthesis.getVoices().length > 0) { selectVoice(); } else { window.speechSynthesis.onvoiceschanged = selectVoice; }
      }
    }
    window.addEventListener('load', () => { setTimeout(speak, 500); });
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
});

// Main handler function - datetime param accepted but ignored, server time used
function handleMakeChange(req, res) {
  const { amount, currency, wallet, userID } = req.params;

  const dollars = parseFloat(amount);
  if (isNaN(dollars) || dollars <= 0) {
    return res.status(400).json([{
      success: 0, notEnoughCash: 0, transactionID: '',
      errorMessage: 'Invalid amount. Must be a positive number.',
      message: 'Invalid amount entered.'
    }]);
  }

  // Generate Transaction ID using server time in AEST (UTC+10)
  const now = new Date();
  const aest = new Date(now.getTime() + (10 * 60 * 60 * 1000));
  const yyyy = aest.getUTCFullYear();
  const mm = String(aest.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(aest.getUTCDate()).padStart(2, '0');
  const hh = String(aest.getUTCHours()).padStart(2, '0');
  const mi = String(aest.getUTCMinutes()).padStart(2, '0');
  const ss = String(aest.getUTCSeconds()).padStart(2, '0');
  const transactionID = `UMC${userID}-${yyyy}${mm}${dd}-${hh}${mi}${ss}`;

  const totalCents = roundToNearest5(Math.round(dollars * 100));

  const walletQtys = wallet.split(',').map(q => parseInt(q) || 0);
  if (walletQtys.length !== 11) {
    return res.status(400).json([{
      success: 0, notEnoughCash: 0, transactionID,
      errorMessage: 'Invalid wallet format. Expected 11 comma separated values.',
      message: 'Wallet data is invalid.'
    }]);
  }

  // Calculate starting and ending wallet values
  let startingWalletValue = 0;
  for (let i = 0; i < AUD_DENOMS.length; i++) {
    startingWalletValue += AUD_DENOMS[i] * walletQtys[i];
  }

  const result = boundedChangeMaking(totalCents, AUD_DENOMS, walletQtys);

  // Not enough cash
  if (result.notEnoughCash) {
    return res.status(200).json([{
      success: 0, notEnoughCash: 1, transactionID,
      amount: totalCents, currency: currency.toUpperCase(),
      note100: 0, note50: 0, note20: 0, note10: 0, note5: 0,
      coin2dollar: 0, coin1dollar: 0, coin50cent: 0, coin20cent: 0, coin10cent: 0, coin5cent: 0,
      amountPaid: 0, changeOwed: 0, exactChange: 0, totalDenominations: 0,
      breakdown: ' ',
      startingWalletValue,
      endingWalletValue: startingWalletValue,
      message: `You don't have enough cash for this purchase of ${formatDollars(totalCents)}.`,
      changeMessage: ' ', errorMessage: 'Not enough cash'
    }]);
  }

  // No solution found
  if (!result.success) {
    return res.status(200).json([{
      success: 0, notEnoughCash: 0, transactionID,
      amount: totalCents, currency: currency.toUpperCase(),
      note100: 0, note50: 0, note20: 0, note10: 0, note5: 0,
      coin2dollar: 0, coin1dollar: 0, coin50cent: 0, coin20cent: 0, coin10cent: 0, coin5cent: 0,
      amountPaid: 0, changeOwed: 0, exactChange: 0, totalDenominations: 0,
      breakdown: ' ',
      startingWalletValue,
      endingWalletValue: startingWalletValue,
      message: 'Unable to make this amount with your current wallet.',
      changeMessage: ' ', errorMessage: 'No solution found'
    }]);
  }

  // Build success response
  const usedCounts = result.usedCounts;
  const amountPaid = result.amountPaid;
  const changeOwed = amountPaid - totalCents;
  const exactChange = changeOwed === 0;
  let totalDenominations = 0;
  const coins = {};
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

  // Calculate ending wallet value
  let endingWalletValue = startingWalletValue;
  for (let i = 0; i < AUD_DENOMS.length; i++) {
    endingWalletValue -= AUD_DENOMS[i] * usedCounts[i];
  }

  // Calculate suggested change breakdown using greedy algorithm
  let changeRemaining = changeOwed;
  const changeCounts = {};
  const changeBreakdownParts = [];
  const changeSpeechParts = [];
  for (let i = 0; i < AUD_DENOMS.length; i++) {
    const qty = Math.floor(changeRemaining / AUD_DENOMS[i]);
    changeCounts[`change_${AUD_LABELS[i]}`] = qty;
    changeRemaining -= qty * AUD_DENOMS[i];
    if (qty > 0) {
      changeBreakdownParts.push(`${qty} x ${AUD_NAMES[i]}`);
      changeSpeechParts.push(`${qty} ${AUD_NAMES[i]}${qty > 1 ? 's' : ''}`);
    }
  }
  const changeBreakdown = changeBreakdownParts.join(', ');

  const breakdown = breakdownParts.join(', ');
  let message = `For a purchase of ${formatDollars(totalCents)}, hand over ${speechParts.join(', and ')}.`;
  message += exactChange ? ' That is exact change.' : ` You will receive ${formatDollars(changeOwed)} change.`;
  const changeMessage = exactChange ? 'Exact change, no change required.' : `Change to receive: ${formatDollars(changeOwed)}`;

  return res.status(200).json([{
    success: 1, notEnoughCash: 0, transactionID,
    amount: totalCents, currency: currency.toUpperCase(),
    ...coins,
    amountPaid, changeOwed,
    exactChange: exactChange ? 1 : 0,
    totalDenominations, breakdown, message, changeMessage,
    ...changeCounts,
    changeBreakdown,
    startingWalletValue,
    endingWalletValue,
    errorMessage: ' '
  }]);
}

// Two routes pointing to same handler (Express 5 doesn't support optional params)
app.get('/api/makechange/:amount/:currency/:wallet/:userID/:datetime', handleMakeChange);
app.get('/api/makechange/:amount/:currency/:wallet/:userID', handleMakeChange);

// Backward compatible endpoint (no wallet)
app.get('/api/makechange/:amount/:currency', (req, res) => {
  const { amount, currency = 'AUD' } = req.params;
  const dollars = parseFloat(amount);
  if (isNaN(dollars) || dollars <= 0) return res.status(400).json([{ error: 'Invalid amount.' }]);
  const totalCents = roundToNearest5(Math.round(dollars * 100));
  const result = boundedChangeMaking(totalCents, AUD_DENOMS, new Array(11).fill(999));
  const coins = {};
  let totalDenominations = 0;
  const breakdownParts = [];
  for (let i = 0; i < AUD_LABELS.length; i++) {
    const qty = result.usedCounts[i];
    coins[AUD_LABELS[i]] = qty;
    if (qty > 0) { totalDenominations++; breakdownParts.push(`${qty} x ${AUD_NAMES[i]}`); }
  }
  return res.status(200).json([{ amount: totalCents, currency: currency.toUpperCase(), ...coins, totalDenominations, breakdown: breakdownParts.join(', ') }]);
});

// Health check
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => console.log(`UseMyCash API running on port ${PORT}`));
