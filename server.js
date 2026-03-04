const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// 常量：最多保留的记录条数
const MAX_RECORDS = 33;

// 中间件：解析纯文本请求体
app.use(express.text({ type: 'text/plain' }));
app.use(cors());

// 数据库连接池
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- 确保表存在的函数 ---
async function ensureTable() {
  try {
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
    process.exit(1);
  }
}

// --- 清理旧数据：保持总数不超过 MAX_RECORDS ---
async function trimOldRecords() {
  try {
    // 查询当前总记录数
    const countResult = await pool.query('SELECT COUNT(*) FROM crowd_data');
    const total = parseInt(countResult.rows[0].count);
    if (total > MAX_RECORDS) {
      const excess = total - MAX_RECORDS;
      // 删除最旧的 excess 条记录（按 timestamp 升序）
      const deleteQuery = `
        DELETE FROM crowd_data
        WHERE id IN (
          SELECT id FROM crowd_data
          ORDER BY created_at ASC
          LIMIT $1
        )
      `;
      await pool.query(deleteQuery, [excess]);
      console.log(`已删除 ${excess} 条旧记录，当前总数: ${MAX_RECORDS}`);
    }
  } catch (err) {
    console.error('清理旧记录时出错:', err);
  }
}

// --- 1. 接收纯文本数据的接口（给ESP32调用）---
app.post('/api/upload', async (req, res) => {
  const rawText = req.body;
  console.log('收到原始数据:', rawText);

  // 解析格式：device_id|people_count|location|timestamp|detection_time
  const parts = rawText.split('|');
  if (parts.length < 5) {
    return res.status(400).json({ error: '格式错误，需要至少5个字段' });
  }

  const device_id = parts[0].trim();
  const people_count = parseInt(parts[1]);
  const location = parts[2].trim();
  const timestamp = parseInt(parts[3]);
  const detection_time = parseFloat(parts[4]);

  if (isNaN(people_count) || isNaN(timestamp) || isNaN(detection_time) || device_id === '' || location === '') {
    return res.status(400).json({ error: '字段解析失败或存在空值' });
  }

  try {
    // 插入新数据
    await pool.query(
      'INSERT INTO crowd_data (device_id, people_count, location, timestamp, detection_time) VALUES ($1, $2, $3, $4, $5)',
      [device_id, people_count, location, timestamp, detection_time]
    );

    // 清理旧记录，保持总数不超过 MAX_RECORDS
    await trimOldRecords();

    res.status(201).json({ status: 'ok' });
  } catch (err) {
    console.error('数据库写入失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

// --- 2. 获取最新数据的接口（给小程序调用）---
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

// --- 3. 获取所有地区列表的接口（给小程序用）---
app.get('/api/locations', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT location FROM crowd_data');
    res.json(result.rows.map(r => r.location));
  } catch (err) {
    console.error('数据库查询失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

app.get('/api/recent', async (req, res) => {
  const { location, limit } = req.query;
  if (!location) {
    return res.status(400).json({ error: '需要提供 location 参数' });
  }
  const recordLimit = parseInt(limit) || 11; // 默认返回11条

  try {
    const result = await pool.query(
      'SELECT people_count, timestamp FROM crowd_data WHERE location = $1 ORDER BY timestamp DESC LIMIT $2',
      [location, recordLimit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('查询最近数据失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

// --- 启动服务器 ---
ensureTable().then(() => {
  app.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
    console.log(`最多保留 ${MAX_RECORDS} 条记录`);
  });
}).catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
