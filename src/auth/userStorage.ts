import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  profilePicture?: string;
  role: 'admin' | 'student';
  course?: 'Design Thinking' | 'Prof. Wamsler Projekt'; // Only for students
  createdAt: string;
}

const USERS_DIR = path.join(process.cwd(), 'users');
const USERS_FILE = path.join(USERS_DIR, 'users.json');

// Ensure users directory exists
if (!fs.existsSync(USERS_DIR)) {
  fs.mkdirSync(USERS_DIR, { recursive: true });
}

// Initialize users file if it doesn't exist
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({}));
}

class UserStorage {
  private users: Map<string, User>;

  constructor() {
    this.users = new Map();
    this.load();
  }

  private load() {
    try {
      const data = fs.readFileSync(USERS_FILE, 'utf-8');
      const usersObj = JSON.parse(data);
      this.users = new Map(Object.entries(usersObj));
    } catch (error) {
      console.error('Error loading users:', error);
      this.users = new Map();
    }
  }

  private save() {
    const usersObj = Object.fromEntries(this.users);
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersObj, null, 2));
  }

  async createUser(email: string, password: string, name: string, role: 'admin' | 'student' = 'student', course?: 'Design Thinking' | 'Prof. Wamsler Projekt'): Promise<User> {
    if (this.findByEmail(email)) {
      throw new Error('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user: User = {
      id: Date.now().toString(),
      email: email.toLowerCase(),
      passwordHash,
      name,
      role,
      course: role === 'student' ? course : undefined, // Only save course for students
      createdAt: new Date().toISOString()
    };

    this.users.set(user.id, user);
    this.save();
    return user;
  }

  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }

  findByEmail(email: string): User | undefined {
    return Array.from(this.users.values()).find(
      user => user.email === email.toLowerCase()
    );
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  async verifyPassword(email: string, password: string): Promise<User | null> {
    const user = this.findByEmail(email);
    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.passwordHash);
    return isValid ? user : null;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return null;

    const updatedUser = { ...user, ...updates, id, email: user.email };
    this.users.set(id, updatedUser);
    this.save();
    return updatedUser;
  }

  async updatePassword(id: string, newPassword: string): Promise<boolean> {
    const user = this.users.get(id);
    if (!user) return false;

    const passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = passwordHash;
    this.users.set(id, user);
    this.save();
    return true;
  }
}

export const userStorage = new UserStorage();
