const { Pool } = require('pg');

// Setup a highly parallelized connection pool to handle PostgreSQL inputs smoothly.
// Shared across every route module — always import the pool from here rather
// than creating a new one, so the whole app uses a single set of connections.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Add SSL configurations here if connecting to a cloud managed instance securely
});

module.exports = pool;
