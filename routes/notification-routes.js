const express = require("express")
const router = express.Router()
const mysql = require("mysql2/promise")
const { SNSClient, CreateTopicCommand, SubscribeCommand, PublishCommand } = require("@aws-sdk/client-sns")

// AWS yapılandırması
const AWS_REGION = process.env.AWS_REGION || "eu-central-1"
const snsClient = new SNSClient({ region: AWS_REGION })

// Veritabanı havuzu
const pool = mysql.createPool({
  host: process.env.RDS_HOSTNAME || "localhost",
  user: process.env.RDS_USERNAME || "root",
  password: process.env.RDS_PASSWORD || "sanane53",
  database: process.env.RDS_DB_NAME || "attendance_system2",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
})

// Bildirim konusu (topic) oluşturma
router.post("/topics", async (req, res) => {
  try {
    const { name, description } = req.body

    // SNS'de topic oluştur
    const command = new CreateTopicCommand({
      Name: `attendance-${name.replace(/[^a-zA-Z0-9-_]/g, "-")}`,
    })

    const response = await snsClient.send(command)
    const topicArn = response.TopicArn

    // Topic'i veritabanına kaydet
    // Bu kısım, veritabanınıza notification_topics tablosunu eklemenizi gerektirir
    const [result] = await pool.execute(
      `INSERT INTO notification_topics (name, description, topic_arn, created_at)
       VALUES (?, ?, ?, NOW())`,
      [name, description, topicArn],
    )

    res.json({
      success: true,
      topicId: result.insertId,
      topicArn,
    })
  } catch (error) {
    console.error("Bildirim konusu oluşturma hatası:", error)
    res.status(500).json({ success: false, message: "Sunucu hatası" })
  }
})

// Bildirim konusuna abone olma
router.post("/subscribe", async (req, res) => {
  try {
    const { topicId, protocol, endpoint, userId, userType } = req.body

    // Topic ARN'yi veritabanından al
    const [topics] = await pool.execute("SELECT topic_arn FROM notification_topics WHERE id = ?", [topicId])

    if (topics.length === 0) {
      return res.status(404).json({ success: false, message: "Bildirim konusu bulunamadı" })
    }

    const topicArn = topics[0].topic_arn

    // SNS'e abone ol
    const command = new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: protocol, // 'email', 'sms', 'application'
      Endpoint: endpoint,
    })

    const response = await snsClient.send(command)
    const subscriptionArn = response.SubscriptionArn

    // Aboneliği veritabanına kaydet
    // Bu kısım, veritabanınıza topic_subscriptions tablosunu eklemenizi gerektirir
    const [result] = await pool.execute(
      `INSERT INTO topic_subscriptions (topic_id, user_id, user_type, protocol, endpoint, subscription_arn, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [topicId, userId, userType, protocol, endpoint, subscriptionArn],
    )

    res.json({
      success: true,
      subscriptionId: result.insertId,
      subscriptionArn,
    })
  } catch (error) {
    console.error("Bildirim aboneliği hatası:", error)
    res.status(500).json({ success: false, message: "Sunucu hatası" })
  }
})

// Bildirim gönderme
router.post("/send", async (req, res) => {
  try {
    const { topicId, message, subject } = req.body

    // Topic ARN'yi veritabanından al
    const [topics] = await pool.execute("SELECT topic_arn FROM notification_topics WHERE id = ?", [topicId])

    if (topics.length === 0) {
      return res.status(404).json({ success: false, message: "Bildirim konusu bulunamadı" })
    }

    const topicArn = topics[0].topic_arn

    // Bildirimi gönder
    const command = new PublishCommand({
      TopicArn: topicArn,
      Message: message,
      Subject: subject || "Yoklama Sistemi Bildirimi",
    })

    const response = await snsClient.send(command)
    const messageId = response.MessageId

    // Bildirim kaydını veritabanına ekle
    // Bu kısım, veritabanınıza sent_notifications tablosunu eklemenizi gerektirir
    await pool.execute(
      `INSERT INTO sent_notifications (topic_id, message, subject, message_id, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [topicId, message, subject, messageId],
    )

    res.json({
      success: true,
      messageId,
    })
  } catch (error) {
    console.error("Bildirim gönderme hatası:", error)
    res.status(500).json({ success: false, message: "Sunucu hatası" })
  }
})

// Kullanıcının bildirimlerini getir
router.get("/user/:userType/:userId", async (req, res) => {
  try {
    const { userType, userId } = req.params

    // Kullanıcının abone olduğu konuları getir
    // Bu kısım, veritabanınıza topic_subscriptions ve notification_topics tablolarını eklemenizi gerektirir
    const [subscriptions] = await pool.execute(
      `SELECT nt.id, nt.name, nt.description, ts.protocol, ts.endpoint, ts.created_at as subscription_date
       FROM topic_subscriptions ts
       JOIN notification_topics nt ON ts.topic_id = nt.id
       WHERE ts.user_id = ? AND ts.user_type = ?`,
      [userId, userType],
    )

    // Kullanıcının son bildirimleri getir
    // Bu kısım, veritabanınıza sent_notifications tablosunu eklemenizi gerektirir
    const [notifications] = await pool.execute(
      `SELECT sn.* 
       FROM sent_notifications sn
       JOIN topic_subscriptions ts ON sn.topic_id = ts.topic_id
       WHERE ts.user_id = ? AND ts.user_type = ?
       ORDER BY sn.created_at DESC
       LIMIT 50`,
      [userId, userType],
    )

    res.json({
      success: true,
      subscriptions,
      notifications,
    })
  } catch (error) {
    console.error("Kullanıcı bildirimleri getirme hatası:", error)
    res.status(500).json({ success: false, message: "Sunucu hatası" })
  }
})

module.exports = router
