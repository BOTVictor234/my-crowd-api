const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// 让我们的API能处理JSON数据和跨域请求
app.use(express.json());
app.use(cors());

// 创建一个连接池，稍后从环境变量读取数据库地址
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Render需要这个SSL设置
});

// --- 1. 接收数据的接口 (给ESP32调用) ---
app.post('/api/upload', async (req, res) => {
  console.log("收到上传请求:", req.body);
  // 假设ESP32发来的数据格式是 { data: { device_id: "...", people_count: ..., location: "...", timestamp: ..., detection_time: ... } }
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

// --- 2. 获取最新数据的接口 (给小程序调用) ---
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

// --- 3. 获取所有地区列表的接口 (给小程序用) ---
app.get('/api/locations', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT location FROM crowd_data');
    res.json(result.rows.map(r => r.location));
  } catch (err) {
    console.error('数据库查询失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

// 启动服务器
app.listen(port, () => {
  console.log(`服务器运行在 http://localhost:${port}`);
});