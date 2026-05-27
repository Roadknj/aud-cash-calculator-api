// index.js - Express.js API for Render deployment

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

// Change Making endpoint
app.get('/api/makechange', (req, res) => {
  const { amount, currency = 'USD' } = req.query;

  // Validate input
  if (!amount) {
    return res.status(400).json([{
      error: 'Missing required parameter: amount',
      example: '/api/makechange?amount=99&currency=AUD'
    }]);
  }

  const cents = parseFloat(amount);
  if (isNaN(cents) || cents < 0) {
    return res.status(400).json([{
      error: 'Invalid amount. Must be a positive number.',
      provided: amount
    }]);
  }

  // Round to avoid floating point issues
  const totalCents = Math.round(cents);

  // Define coin denominations per currency
  let denominations, labels;

  switch (currency.toUpperCase()) {
    case 'USD':
      denominations = [25, 10, 5, 1];
      labels = ['quarters', 'dimes', 'nickels', 'pennies'];
      break;
    case 'EUR':
      denominations = [200, 100, 50, 20, 10, 5, 2, 1];
      labels = ['2euro', '1euro', '50cent', '20cent', '10cent', '5cent', '2cent', '1cent'];
      break;
    case 'GBP':
      denominations = [200, 100, 50, 20, 10, 5, 2, 1];
      labels = ['2pound', '1pound', '50p', '20p', '10p', '5p', '2p', '1p'];
      break;
    case 'AUD':
      // Australia has no 1c or 2c coins (retired 1992)
      denominations = [200, 100, 50, 20, 10, 5];
      labels = ['2dollar', '1dollar', '50cent', '20cent', '10cent', '5cent'];
      break;
    default:
      denominations = [25, 10, 5, 1];
      labels = ['quarters', 'dimes', 'nickels', 'pennies'];
  }

  // Greedy algorithm for change making
  const coins = {};
  let remaining = totalCents;
  let totalCoins = 0;

  for (let i = 0; i < denominations.length; i++) {
    const count = Math.floor(remaining / denominations[i]);
    coins[labels[i]] = count;
    totalCoins += count;
    remaining = remaining % denominations[i];
  }

  // Return as JSON array (required by Adalo External Collections)
  return res.status(200).json([{
    amount: totalCents,
    currency: currency.toUpperCase(),
    ...coins,
    totalCoins,
    breakdown: Object.entries(coins)
      .filter(([_, count]) => count > 0)
      .map(([coin, count]) => `${count} ${coin}`)
      .join(', ') || 'No coins needed'
  }]);
});

// Health check endpoint (recommended for Render)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Change Making API running on port ${PORT}`);
});
