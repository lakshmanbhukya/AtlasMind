'use strict';
const fs = require('fs');
const path = require('path');

const e2eSubset = fs.readFileSync(path.resolve(__dirname, '../benchmark/e2e_subset.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);

const intentions = {};

for (const q of e2eSubset) {
  if (!q.humanAmbiguous) continue;

  let intendedMetric = q.goldCandidate || 'items[].price';
  let intendedInterpretation = '';

  if (q.dataset === 'sample_supplies') {
    // Vary between quantity and price/revenue to reflect realistic users
    if (q.text.includes('sellers') || q.text.includes('popular') || q.id === 'supplies-0064' || q.id === 'supplies-0066' || q.id === 'supplies-0074' || q.id === 'supplies-0080') {
      intendedMetric = 'items[].quantity';
      intendedInterpretation = 'Rank products by total quantity sold (items.quantity)';
    } else {
      intendedMetric = 'items[].price';
      intendedInterpretation = 'Rank products by total sales revenue (items.price)';
    }
  } else if (q.dataset === 'sample_analytics') {
    if (q.text.includes('activity') || q.text.includes('transactions count')) {
      intendedMetric = 'transaction_count';
      intendedInterpretation = 'Rank by total transaction count (transaction_count)';
    } else {
      intendedMetric = 'transactions[].amount';
      intendedInterpretation = 'Rank by total transaction trading amount (transactions.amount)';
    }
  } else if (q.dataset === 'sample_mflix') {
    if (q.text.includes('reception') || q.text.includes('rating')) {
      intendedMetric = 'imdb.rating';
      intendedInterpretation = 'Rank films by viewer rating (imdb.rating)';
    } else {
      intendedMetric = 'awards.wins';
      intendedInterpretation = 'Rank films by number of award wins (awards.wins)';
    }
  }

  intentions[q.id] = {
    id: q.id,
    dataset: q.dataset,
    category: q.category,
    text: q.text,
    intendedMetric,
    intendedInterpretation,
  };
}

fs.writeFileSync(
  path.resolve(__dirname, '../benchmark/hidden_intentions.json'),
  JSON.stringify(intentions, null, 2)
);

console.log(`Generated hidden intentions for ${Object.keys(intentions).length} ambiguous queries.`);
