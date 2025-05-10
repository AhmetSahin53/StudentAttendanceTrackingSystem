// db.js
// This file is a simplified version of db-config.js to provide the query function.

import mysql from "mysql2/promise"

// RDS bağlantı havuzu oluştur
const pool = mysql.createPool({
  host: process.env.RDS_HOSTNAME,
  user: process.env.RDS_USERNAME,
  password: process.env.RDS_PASSWORD,
  database: process.env.RDS_DB_NAME,
  port: process.env.RDS_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
})

// Veritabanı sorguları için yardımcı fonksiyon
export async function query(sql, params) {
  try {
    const [results] = await pool.execute(sql, params)
    return results
  } catch (error) {
    console.error("Veritabanı sorgusu hatası:", error)
    throw error
  }
}
