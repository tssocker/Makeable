import 'dotenv/config';
import { userStorage } from './src/auth/userStorage.js';

async function createAdmin() {
  const email = process.argv[2];
  const password = process.argv[3];
  const name = process.argv[4];

  if (!email || !password || !name) {
    console.error('Usage: npm run create-admin <email> <password> <name>');
    console.error('Example: npm run create-admin admin@example.com mypassword "Admin Name"');
    process.exit(1);
  }

  try {
    const user = await userStorage.createUser(email, password, name, 'admin');
    console.log('✅ Admin user created successfully!');
    console.log('Email:', user.email);
    console.log('Name:', user.name);
    console.log('Role:', user.role);
    console.log('\nYou can now login with these credentials.');
  } catch (error) {
    console.error('❌ Error creating admin:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

createAdmin();
