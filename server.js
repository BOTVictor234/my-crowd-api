const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- 新增：确保表存在的函数 ---
async function ensureTable() {
  try {
    // 检查表是否存在
    const checkQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'crowd_data'
      );
    `;
    const res = await pool.query(checkQuery);
    const tableExists = res.rows[0].exists;
    
    if (!tableExists) {
      console.log('表 crowd_data 不存在，正在创建...');
      const createQuery = `
        CREATE TABLE crowd_data (
          id SERIAL PRIMARY KEY,
          device_id VARCHAR(50),
          people_count INTEGER,
          location VARCHAR(100),
          timestamp BIGINT,
          detection_time FLOAT,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `;
      await pool.query(createQuery);
      console.log('表 crowd_data 创建成功');
    } else {
      console.log('表 crowd_data 已存在');
    }
  } catch (err) {
    console.error('检查/创建表时出错:', err);
    process.exit(1); // 如果数据库连接失败，直接退出
  }
}

// --- API 路由 ---
app.post('/api/upload', async (req, res) => {
  console.log("收到上传请求:", req.body);
  const { device_id, people_count, location, timestamp, detection_time } = req.body.data || {};

  if (!device_id || people_count === undefined || !location) {
    return res.status(400).json({ error: '数据不完整' });
  }

  try {
    await pool.query(
      'INSERT INTO crowd_data (device_id, people_count, location, timestamp, detection_time) VALUES ($1, $2, $3, $4, $5)',
      [device_id, people_count, location, timestamp, detection_time]
    );
    res.status(201).json({ status: 'ok' });
  } catch (err) {
    console.error('数据库写入失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

app.get('/api/latest', async (req, res) => {
  const { location } = req.query;
  if (!location) return res.status(400).json({ error: '需要提供 location 参数' });

  try {
    const result = await pool.query(
      'SELECT people_count, timestamp FROM crowd_data WHERE location = $1 ORDER BY timestamp DESC LIMIT 1',
      [location]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: '暂无数据' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('数据库查询失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

app.get('/api/locations', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT location FROM crowd_data');
    res.json(result.rows.map(r => r.location));
  } catch (err) {
    console.error('数据库查询失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

// --- 启动服务器前先确保表存在 ---
ensureTable().then(() => {
  app.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
  });
}).catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
