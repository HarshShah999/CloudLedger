import pool from './config/db';

const testDB = async () => {
    try {
        // Test connection
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', result.rows[0]);

        // Check if users table exists
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'users'
            );
        `);
        console.log('Users table exists:', tableCheck.rows[0].exists);

        // If table exists, check structure
        if (tableCheck.rows[0].exists) {
            const columns = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'users';
            `);
            console.log('Users table columns:', columns.rows);
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Database test failed:', error);
        process.exit(1);
    }
};

testDB();
