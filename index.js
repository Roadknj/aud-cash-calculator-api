// Simple Node.js API for AUD Cash Calculator
// This API calculates which denominations to use based on pocket inventory

const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// AUD denominations in cents (largest to smallest)
const DENOMINATIONS = [
  { value: 10000, name: '$100', type: 'note' },
  { value: 5000, name: '$50', type: 'note' },
  { value: 2000, name: '$20', type: 'note' },
  { value: 1000, name: '$10', type: 'note' },
  { value: 500, name: '$5', type: 'note' },
  { value: 200, name: '$2', type: 'coin' },
  { value: 100, name: '$1', type: 'coin' },
  { value: 50, name: '50c', type: 'coin' },
  { value: 20, name: '20c', type: 'coin' },
  { value: 10, name: '10c', type: 'coin' },
  { value: 5, name: '5c', type: 'coin' }
];

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'AUD Cash Calculator API is running',
    version: '1.0.0'
  });
});

// Main calculation endpoint
app.post('/calculate', (req, res) => {
  try {
    const { purchaseAmount, pocket } = req.body;

    // Validation
    if (!purchaseAmount || purchaseAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid purchase amount'
      });
    }

    if (!pocket || Object.keys(pocket).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide your pocket inventory'
      });
    }

    // Convert purchase amount to cents
    const purchaseCents = Math.round(purchaseAmount * 100);

    // Calculate total available in pocket
    let totalAvailable = 0;
    for (const [denomValue, count] of Object.entries(pocket)) {
      totalAvailable += parseInt(denomValue) * parseInt(count);
    }

    // Check if enough money
    if (totalAvailable < purchaseCents) {
      return res.json({
        success: false,
        error: `Not enough money. You have $${(totalAvailable / 100).toFixed(2)} but need $${purchaseAmount.toFixed(2)}`,
        totalAvailable: totalAvailable / 100,
        amountNeeded: purchaseAmount
      });
    }

    // Greedy algorithm
    let remaining = purchaseCents;
    const breakdown = [];
    const availableDenoms = { ...pocket };

    for (const denom of DENOMINATIONS) {
      const available = parseInt(availableDenoms[denom.value]) || 0;

      if (available > 0 && remaining >= denom.value) {
        const needed = Math.floor(remaining / denom.value);
        const toUse = Math.min(needed, available);

        if (toUse > 0) {
          remaining -= toUse * denom.value;
          breakdown.push({
            value: denom.value,
            name: denom.name,
            type: denom.type,
            count: toUse
          });
        }
      }
    }

    // Check if exact change is possible
    if (remaining > 0) {
      return res.json({
        success: false,
        error: `Cannot make exact change with the money you have. You're $${(remaining / 100).toFixed(2)} short with your current denominations.`,
        shortfall: remaining / 100
      });
    }

    // Success!
    return res.json({
      success: true,
      purchaseAmount: purchaseAmount,
      totalUsed: purchaseCents / 100,
      breakdown: breakdown,
      remainingInPocket: (totalAvailable - purchaseCents) / 100
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AUD Cash Calculator API running on port ${PORT}`);
});