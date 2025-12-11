
import fs from 'fs/promises';

const checkPath = async (p: string) => {
    console.log(`Checking path: ${p}`);
    try {
        const stats = await fs.stat(p);
        console.log(`✅ Success! Stats:`, stats);
    } catch (error: any) {
        console.log(`❌ Failed:`, error.message);
    }
};

const run = async () => {
    await checkPath('C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe');
    await checkPath('C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe');
};

run();
