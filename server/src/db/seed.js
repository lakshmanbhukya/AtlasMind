/**
 * Database seeder — populates sample_sales and few_shot_examples.
 *
 * Usage: npm run seed
 * Requires: MONGODB_URI in .env
 */
require('dotenv').config();

const { connectToDatabase, getDb, closeConnection } = require('./connection');

// ---------------------------------------------------------------------------
// Sample Sales Data Generator
// ---------------------------------------------------------------------------
const CUSTOMERS = [
    'Alice Chen', 'Bob Martinez', 'Charlie Kim', 'Diana Patel', 'Evan O\'Brien',
    'Fiona Li', 'George Tanaka', 'Hannah Wilson', 'Ivan Petrov', 'Julia Santos',
    'Kevin Brown', 'Laura Schmidt', 'Michael Ng', 'Nina Johansson', 'Oscar Reyes',
    'Priya Sharma', 'Quinn Murphy', 'Rachel Cohen', 'Sameer Gupta', 'Tanya Ivanova',
];

const PRODUCTS = [
    'Wireless Headphones', 'Laptop Stand', 'USB-C Hub', 'Mechanical Keyboard',
    'Monitor Light Bar', 'Webcam HD', 'Portable SSD', 'Desk Mat', 'Cable Organizer',
    'Noise Cancelling Earbuds', 'Smart Mouse', 'Docking Station', 'Phone Stand',
    'Blue Light Glasses', 'Microphone', 'Ring Light', 'Surge Protector', 'Tablet Sleeve',
];

const CATEGORIES = [
    'Electronics', 'Accessories', 'Audio', 'Storage', 'Peripherals', 'Lighting',
];

const REGIONS = ['North America', 'Europe', 'Asia Pacific', 'South America', 'Africa'];

const STATUSES = ['completed', 'pending', 'refunded'];

function randomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomFloat(min, max) {
    return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

function randomDate(startYear, endYear) {
    const start = new Date(`${startYear}-01-01`).getTime();
    const end = new Date(`${endYear}-12-31`).getTime();
    return new Date(start + Math.random() * (end - start));
}

function generateSalesDocuments(count = 200) {
    const docs = [];
    for (let i = 0; i < count; i++) {
        docs.push({
            customer: randomElement(CUSTOMERS),
            product: randomElement(PRODUCTS),
            category: randomElement(CATEGORIES),
            region: randomElement(REGIONS),
            amount: randomFloat(9.99, 999.99),
            quantity: Math.floor(Math.random() * 10) + 1,
            status: randomElement(STATUSES),
            date: randomDate(2025, 2026),
            discount: Math.random() > 0.7 ? randomFloat(0.05, 0.30) : 0,
            rating: Math.floor(Math.random() * 5) + 1,
        });
    }
    return docs;
}

// ---------------------------------------------------------------------------
// Few-Shot Examples (NL → MQL pairs)
// ---------------------------------------------------------------------------
const FEW_SHOT_EXAMPLES = [
    {
        natural_language: 'Show total revenue by region',
        mql_pipeline: [
            { $match: { status: 'completed' } },
            { $group: { _id: '$region', totalRevenue: { $sum: '$amount' } } },
            { $sort: { totalRevenue: -1 } },
        ],
        collection: 'sample_sales',
        chart_type: 'bar',
        tags: ['revenue', 'region', 'group'],
    },
    {
        natural_language: 'Top 5 customers by total spending',
        mql_pipeline: [
            { $match: { status: 'completed' } },
            { $group: { _id: '$customer', totalSpent: { $sum: '$amount' } } },
            { $sort: { totalSpent: -1 } },
            { $limit: 5 },
        ],
        collection: 'sample_sales',
        chart_type: 'bar',
        tags: ['customer', 'spending', 'top'],
    },
    {
        natural_language: 'Monthly sales trend',
        mql_pipeline: [
            { $match: { status: 'completed' } },
            {
                $group: {
                    _id: {
                        year: { $year: '$date' },
                        month: { $month: '$date' },
                    },
                    totalSales: { $sum: '$amount' },
                    orderCount: { $sum: 1 },
                },
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
        ],
        collection: 'sample_sales',
        chart_type: 'line',
        tags: ['monthly', 'trend', 'time-series'],
    },
    {
        natural_language: 'Revenue breakdown by product category',
        mql_pipeline: [
            { $match: { status: 'completed' } },
            { $group: { _id: '$category', revenue: { $sum: '$amount' } } },
            { $sort: { revenue: -1 } },
        ],
        collection: 'sample_sales',
        chart_type: 'pie',
        tags: ['category', 'breakdown', 'revenue'],
    },
    {
        natural_language: 'Average order value by region',
        mql_pipeline: [
            { $match: { status: 'completed' } },
            {
                $group: {
                    _id: '$region',
                    avgOrderValue: { $avg: '$amount' },
                    orderCount: { $sum: 1 },
                },
            },
            { $sort: { avgOrderValue: -1 } },
        ],
        collection: 'sample_sales',
        chart_type: 'bar',
        tags: ['average', 'order', 'region'],
    },
    {
        natural_language: 'How many orders are pending vs completed vs refunded',
        mql_pipeline: [
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ],
        collection: 'sample_sales',
        chart_type: 'pie',
        tags: ['status', 'count', 'distribution'],
    },
    {
        natural_language: 'Which products have the highest average rating',
        mql_pipeline: [
            {
                $group: {
                    _id: '$product',
                    avgRating: { $avg: '$rating' },
                    totalSales: { $sum: 1 },
                },
            },
            { $match: { totalSales: { $gte: 3 } } },
            { $sort: { avgRating: -1 } },
            { $limit: 10 },
        ],
        collection: 'sample_sales',
        chart_type: 'bar',
        tags: ['product', 'rating', 'average'],
    },
    {
        natural_language: 'Total number of orders per customer',
        mql_pipeline: [
            { $group: { _id: '$customer', orderCount: { $sum: 1 } } },
            { $sort: { orderCount: -1 } },
        ],
        collection: 'sample_sales',
        chart_type: 'bar',
        tags: ['customer', 'orders', 'count'],
    },
    {
        natural_language: 'Revenue from discounted orders',
        mql_pipeline: [
            { $match: { discount: { $gt: 0 }, status: 'completed' } },
            {
                $group: {
                    _id: null,
                    totalDiscountedRevenue: { $sum: '$amount' },
                    avgDiscount: { $avg: '$discount' },
                    discountedOrders: { $sum: 1 },
                },
            },
        ],
        collection: 'sample_sales',
        chart_type: 'table',
        tags: ['discount', 'revenue', 'aggregate'],
    },
    {
        natural_language: 'Sales by product in Europe',
        mql_pipeline: [
            { $match: { region: 'Europe', status: 'completed' } },
            { $group: { _id: '$product', totalSales: { $sum: '$amount' } } },
            { $sort: { totalSales: -1 } },
            { $limit: 10 },
        ],
        collection: 'sample_sales',
        chart_type: 'bar',
        tags: ['product', 'europe', 'region', 'sales'],
    },
    {
        natural_language: 'Daily order count for the last month',
        mql_pipeline: [
            {
                $match: {
                    date: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 1)) },
                },
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$date' },
                        month: { $month: '$date' },
                        day: { $dayOfMonth: '$date' },
                    },
                    orderCount: { $sum: 1 },
                },
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
        ],
        collection: 'sample_sales',
        chart_type: 'line',
        tags: ['daily', 'orders', 'time-series'],
    },
    {
        natural_language: 'Show refund rate by product category',
        mql_pipeline: [
            {
                $group: {
                    _id: '$category',
                    totalOrders: { $sum: 1 },
                    refundedOrders: {
                        $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] },
                    },
                },
            },
            {
                $addFields: {
                    refundRate: {
                        $round: [{ $multiply: [{ $divide: ['$refundedOrders', '$totalOrders'] }, 100] }, 2],
                    },
                },
            },
            { $sort: { refundRate: -1 } },
        ],
        collection: 'sample_sales',
        chart_type: 'bar',
        tags: ['refund', 'category', 'rate'],
    },
    {
        natural_language: 'Total quantity sold per product',
        mql_pipeline: [
            { $match: { status: 'completed' } },
            { $group: { _id: '$product', totalQuantity: { $sum: '$quantity' } } },
            { $sort: { totalQuantity: -1 } },
        ],
        collection: 'sample_sales',
        chart_type: 'bar',
        tags: ['quantity', 'product', 'total'],
    },
    {
        natural_language: 'Customers with more than 5 orders',
        mql_pipeline: [
            { $group: { _id: '$customer', orderCount: { $sum: 1 }, totalSpent: { $sum: '$amount' } } },
            { $match: { orderCount: { $gt: 5 } } },
            { $sort: { orderCount: -1 } },
        ],
        collection: 'sample_sales',
        chart_type: 'table',
        tags: ['customer', 'frequent', 'orders'],
    },
    {
        natural_language: 'Revenue comparison between North America and Europe',
        mql_pipeline: [
            { $match: { region: { $in: ['North America', 'Europe'] }, status: 'completed' } },
            { $group: { _id: '$region', totalRevenue: { $sum: '$amount' } } },
            { $sort: { totalRevenue: -1 } },
        ],
        collection: 'sample_sales',
        chart_type: 'bar',
        tags: ['comparison', 'region', 'revenue'],
    },
];

// ---------------------------------------------------------------------------
// Main Seed Function
// ---------------------------------------------------------------------------
async function seed() {
    console.log('\n🌱 Starting database seed...\n');

    await connectToDatabase();
    const db = getDb();

    // --- Seed sample_sales ---
    const salesCollection = db.collection('sample_sales');
    const existingSales = await salesCollection.estimatedDocumentCount();

    if (existingSales > 0) {
        console.log(`   sample_sales already has ${existingSales} documents. Dropping and re-seeding...`);
        await salesCollection.drop();
    }

    const salesDocs = generateSalesDocuments(200);
    await salesCollection.insertMany(salesDocs);
    console.log(`   ✅ Inserted ${salesDocs.length} documents into sample_sales`);

    // Create indexes
    await salesCollection.createIndex({ customer: 1 });
    await salesCollection.createIndex({ region: 1 });
    await salesCollection.createIndex({ category: 1 });
    await salesCollection.createIndex({ date: -1 });
    await salesCollection.createIndex({ status: 1 });
    console.log('   ✅ Created indexes on sample_sales');

    // --- Seed few_shot_examples ---
    const examplesCollection = db.collection('few_shot_examples');
    const existingExamples = await examplesCollection.estimatedDocumentCount();

    if (existingExamples > 0) {
        console.log(`   few_shot_examples already has ${existingExamples} documents. Dropping and re-seeding...`);
        await examplesCollection.drop();
    }

    await examplesCollection.insertMany(FEW_SHOT_EXAMPLES);
    console.log(`   ✅ Inserted ${FEW_SHOT_EXAMPLES.length} few-shot examples`);

    // Create text index for fallback search
    await examplesCollection.createIndex(
        { natural_language: 'text', tags: 'text' },
        { name: 'text_search_index' }
    );
    console.log('   ✅ Created text index on few_shot_examples');

    // --- Ensure dashboards and query_history collections exist ---
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map((c) => c.name);

    if (!collectionNames.includes('dashboards')) {
        await db.createCollection('dashboards');
        console.log('   ✅ Created dashboards collection');
    }

    if (!collectionNames.includes('query_history')) {
        await db.createCollection('query_history');
        await db.collection('query_history').createIndex({ timestamp: -1 });
        console.log('   ✅ Created query_history collection with index');
    }

    console.log('\n🎉 Seed complete!\n');
    console.log('   Collections:');
    console.log(`   • sample_sales: ${salesDocs.length} documents`);
    console.log(`   • few_shot_examples: ${FEW_SHOT_EXAMPLES.length} examples`);
    console.log('   • dashboards: ready');
    console.log('   • query_history: ready\n');

    await closeConnection();
}

seed().catch((error) => {
    console.error('❌ Seed failed:', error);
    closeConnection().then(() => process.exit(1));
});
