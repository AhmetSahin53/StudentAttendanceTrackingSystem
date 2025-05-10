// test-db-connection.js
const mysql = require('mysql2');
const dotenv = require('dotenv');

// .env dosyasını yükle
dotenv.config();

// Veritabanı bağlantı bilgileri
const dbConfig = {
  host: process.env.RDS_HOSTNAME || 'localhost',
  user: process.env.RDS_USERNAME || 'root',
  password: process.env.RDS_PASSWORD || 'sanane53',
  database: process.env.RDS_DB_NAME || 'attendance_system2',
  port: process.env.RDS_PORT || 3306
};

console.log('Veritabanı bağlantı bilgileri:');
console.log(`Host: ${dbConfig.host}`);
console.log(`Database: ${dbConfig.database}`);
console.log(`User: ${dbConfig.user}`);
console.log(`Port: ${dbConfig.port}`);

// Veritabanı bağlantısı oluştur
const connection = mysql.createConnection(dbConfig);

// Bağlantıyı test et
connection.connect((err) => {
  if (err) {
    console.error('Veritabanı bağlantı hatası:', err);
    return;
  }
  
  console.log('RDS veritabanına başarıyla bağlandı!');
  
  // Basit bir sorgu çalıştır
  connection.query('SHOW TABLES', (err, results) => {
    if (err) {
      console.error('Sorgu hatası:', err);
      return;
    }
    
    console.log('Veritabanındaki tablolar:');
    results.forEach((row) => {
      console.log(`- ${row[`Tables_in_${dbConfig.database}`]}`);
    });
    
    // Bağlantıyı kapat
    connection.end((err) => {
      if (err) {
        console.error('Bağlantı kapatma hatası:', err);
        return;
      }
      console.log('Veritabanı bağlantısı kapatıldı.');
    });
  });
});