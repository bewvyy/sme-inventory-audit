const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = 3000;
const MONGO_URL = 'mongodb://127.0.0.1:27017';
const DATABASE_NAME = 'sme_inventory_db';

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

let db, productsCol, logsCol, users;

// Helper: บันทึก Audit Log พร้อมตรวจจับ After-Hours Rule (08:30 - 17:30 น.)[cite: 3]
async function logActivity(username, action, details) {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // นอกเวลาทำการ (ก่อน 08:30 หรือ หลัง 17:30)[cite: 3]
  const isAfterHours = timeInMinutes < (8 * 60 + 30) || timeInMinutes > (17 * 60 + 30);
  const actionStatus = isAfterHours ? `AFTER_HOURS_${action}` : action;

  const logEntry = {
    timestamp: now,
    username: username || 'unknown_user',
    action: actionStatus,
    details: details
  };

  try {
    await logsCol.insertOne(logEntry);
  } catch (err) {
    console.error('Error writing audit log:', err);
  }
}

// POST /api/register — ลงทะเบียน / สร้างพนักงานใหม่
app.post('/api/register', async (req, res) => {
  const { username, name, email, password, role } = req.body;
  if (!username || !name || !email || !password) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  const userRole = role || 'member';
  const user = { username, name, email: email.toLowerCase(), role: userRole, createdAt: new Date() };

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await users.insertOne({ ...user, passwordHash });
    res.status(201).json({ _id: result.insertedId, ...user });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'username หรือ email นี้ถูกใช้งานแล้ว' });
    }
    res.status(500).json({ error: 'ไม่สามารถสร้างผู้ใช้ได้' });
  }
});

// POST /api/login — เข้าสู่ระบบ[cite: 2]
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await users.findOne({ username });
  const ok = user && await bcrypt.compare(password ?? '', user.passwordHash);

  if (!ok) {
    return res.status(401).json({ error: 'username หรือรหัสผ่านไม่ถูกต้อง' });
  }

  res.json({ username: user.username, name: user.name, role: user.role });
});

// GET /api/products — ดึงรายการสินค้า
app.get('/api/products', async (req, res) => {
  try {
    const products = await productsCol.find({}).toArray();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถดึงข้อมูลสินค้าได้' });
  }
});

// POST /api/products — เพิ่มสินค้าใหม่
app.post('/api/products', async (req, res) => {
  const { productId, productName, quantity, username } = req.body;
  if (!productId || !productName || quantity === undefined) {
    return res.status(400).json({ error: 'กรอกข้อมูลสินค้าไม่ครบถ้วน' });
  }

  try {
    const newProduct = {
      product_id: productId,
      product_name: productName,
      quantity: Number(quantity),
      updated_at: new Date()
    };
    const result = await productsCol.insertOne(newProduct);
    await logActivity(username, 'CREATE', `เพิ่มสินค้าใหม่: ${productName} (${productId}) จำนวน ${quantity} ชิ้น`);
    res.status(201).json({ _id: result.insertedId, ...newProduct });
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถเพิ่มสินค้าได้' });
  }
});

// POST /api/products/:id/stock — ปรับสต็อก (เติม / เบิก)
app.post('/api/products/:id/stock', async (req, res) => {
  const { actionType, amount, note, username } = req.body;
  const changeQty = Number(amount);

  try {
    const product = await productsCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

    let newQty = product.quantity;
    if (actionType === 'RESTOCK') {
      newQty += changeQty;
    } else if (actionType === 'EXPORT') {
      if (product.quantity < changeQty) {
        return res.status(400).json({ error: 'จำนวนสินค้าในคลังไม่พอสำหรับเบิก' });
      }
      newQty -= changeQty;
    }

    await productsCol.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { quantity: newQty, updated_at: new Date() } }
    );

    const logText = `${actionType === 'RESTOCK' ? 'เติมสต็อก' : 'เบิกสินค้า'}: ${product.product_name} จำนวน ${changeQty} ชิ้น (เหตุผล: ${note || '-'})`;
    await logActivity(username, actionType, logText);

    res.json({ message: 'ปรับปรุงสต็อกเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถปรับสต็อกได้' });
  }
});

// DELETE /api/products/:id — ลบสินค้า
app.delete('/api/products/:id', async (req, res) => {
  const username = req.query.username;
  try {
    const product = await productsCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

    await productsCol.deleteOne({ _id: new ObjectId(req.params.id) });
    await logActivity(username, 'DELETE', `ลบสินค้า: ${product.product_name} (${product.product_id})`);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถลบสินค้าได้' });
  }
});

// GET /api/audit-logs — ดึงประวัติกิจกรรม (เปิดให้ดึงข้อมูลได้เพื่อใช้ประมวลผล Dashboard)[cite: 1]
app.get('/api/audit-logs', async (req, res) => {
  try {
    const logs = await logsCol.find({}).sort({ timestamp: -1 }).toArray();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถดึงประวัติได้' });
  }
});

// เริ่มทำงานเซิร์ฟเวอร์
async function startServer() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DATABASE_NAME);
  productsCol = db.collection('products');
  logsCol = db.collection('activity_logs');
  users = db.collection('users');

  await users.createIndex({ username: 1 }, { unique: true }).catch(() => {});
  await users.createIndex({ email: 1 }, { unique: true }).catch(() => {});

  // สร้างบัญชี admin เริ่มต้นหากยังไม่มีในระบบ
  const adminExists = await users.findOne({ username: 'admin' });
  if (!adminExists) {
    const passwordHash = await bcrypt.hash('123', 10);
    await users.insertOne({
      username: 'admin',
      name: 'ผู้ดูแลระบบ',
      email: 'admin@example.com',
      passwordHash: passwordHash,
      role: 'admin',
      createdAt: new Date()
    });
  }

  console.log('Connected successfully to MongoDB server');
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
