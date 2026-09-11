const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function repair() {
  const dbs = ['vishvaerp', 'vishva_erp'];
  for (const dbName of dbs) {
    const conn = await mongoose.createConnection(`mongodb://localhost:27017/${dbName}`).asPromise();
    console.log(`Checking ${dbName}...`);
    const usersCol = conn.collection('users');
    const users = await usersCol.find({}).toArray();
    console.log(`${dbName} total users:`, users.length);
    
    let repaired = 0;
    for (const u of users) {
      if (!u.password || typeof u.password !== 'string' || !u.password.trim()) {
        const defaultPassword = u.role === 'student' ? 'Student@123' : (u.role === 'faculty' ? 'Faculty@123' : 'User@123');
        const hash = await bcrypt.hash(defaultPassword, 12);
        await usersCol.updateOne({ _id: u._id }, { $set: { password: hash } });
        console.log(`[${dbName}] Repaired missing password for ${u.email} (${u.role}) -> hash generated for ${defaultPassword}`);
        repaired++;
      } else if (!u.password.startsWith('$2a$') && !u.password.startsWith('$2b$')) {
        const hash = await bcrypt.hash(u.password, 12);
        await usersCol.updateOne({ _id: u._id }, { $set: { password: hash } });
        console.log(`[${dbName}] Converted plaintext password to bcrypt for ${u.email}`);
        repaired++;
      }
    }
    console.log(`${dbName} repaired: ${repaired}`);
    await conn.close();
  }
  console.log('Database inspection & repair complete.');
}

repair().catch(err => {
  console.error('Repair error:', err);
  process.exit(1);
});
