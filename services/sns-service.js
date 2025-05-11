const { PublishCommand, CreateTopicCommand, SubscribeCommand } = require("@aws-sdk/client-sns")
const { snsClient } = require("../aws-config")

/**
 * SNS servisini yöneten sınıf
 */
class SNSService {
  /**
   * Bildirim gönderir
   * @param {string} message - Bildirim mesajı
   * @param {string} subject - Bildirim konusu
   * @returns {Promise<object>} - SNS yanıtı
   */
  async sendNotification(message, subject) {
    try {
      const params = {
        Message: message,
        Subject: subject,
        TopicArn: process.env.SNS_TOPIC_ARN || process.env.SNS_GENERAL_TOPIC_ARN,
      }

      const command = new PublishCommand(params)
      const response = await snsClient.send(command)
      console.log(`Bildirim gönderildi: ${response.MessageId}`)
      return response
    } catch (error) {
      console.error(`Bildirim gönderilirken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Yeni bir SNS topic oluşturur
   * @param {string} topicName - Topic adı
   * @returns {Promise<string>} - Topic ARN
   */
  async createTopic(topicName) {
    try {
      const command = new CreateTopicCommand({
        Name: topicName,
      })

      const response = await snsClient.send(command)
      console.log(`SNS topic oluşturuldu: ${response.TopicArn}`)
      return response.TopicArn
    } catch (error) {
      console.error(`SNS topic oluşturulurken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Bir topic'e abone olur
   * @param {string} topicArn - Topic ARN
   * @param {string} protocol - Protokol (email, sms, http, https, lambda)
   * @param {string} endpoint - Endpoint (email adresi, telefon numarası, URL)
   * @returns {Promise<string>} - Abonelik ARN
   */
  async subscribe(topicArn, protocol, endpoint) {
    try {
      const command = new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: protocol,
        Endpoint: endpoint,
      })

      const response = await snsClient.send(command)
      console.log(`SNS aboneliği oluşturuldu: ${response.SubscriptionArn}`)
      return response.SubscriptionArn
    } catch (error) {
      console.error(`SNS aboneliği oluşturulurken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Email adresini SNS'e abone eder
   * @param {string} email - Email adresi
   * @returns {Promise<string>} - Abonelik ARN
   */
  async subscribeEmail(email) {
    try {
      const topicArn = process.env.SNS_TOPIC_ARN || process.env.SNS_GENERAL_TOPIC_ARN
      if (!topicArn) {
        throw new Error("SNS Topic ARN bulunamadı")
      }

      return await this.subscribe(topicArn, "email", email)
    } catch (error) {
      console.error(`Email aboneliği oluşturulurken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Bildirimi veritabanına kaydeder
   * @param {number} userId - Kullanıcı ID
   * @param {string} title - Bildirim başlığı
   * @param {string} message - Bildirim mesajı
   * @param {object} db - Veritabanı bağlantısı
   * @returns {Promise<number>} - Eklenen bildirim ID'si
   */
  async saveNotificationToDb(userId, title, message, db) {
    return new Promise((resolve, reject) => {
      db.query(
        "INSERT INTO notifications (user_id, title, message, is_read, created_at) VALUES (?, ?, ?, FALSE, NOW())",
        [userId, title, message],
        (err, result) => {
          if (err) {
            console.error(`Bildirim veritabanına kaydedilirken hata oluştu: ${err.message}`)
            return reject(err)
          }
          resolve(result.insertId)
        },
      )
    })
  }

  /**
   * Öğrenciye yoklama hatırlatması gönderir
   * @param {string} studentEmail - Öğrenci email adresi
   * @param {string} courseName - Ders adı
   * @returns {Promise<object>} - SNS yanıtı
   */
  async sendAttendanceReminder(studentEmail, courseName) {
    const message = `Sayın öğrencimiz, ${courseName} dersi için bugün yoklamanızı almayı unutmayınız.`
    const subject = "Yoklama Hatırlatması"

    // Gerçek uygulamada, öğrencinin email'ine doğrudan gönderim için
    // önce bir abonelik oluşturulmalı ve onaylanmalıdır
    return await this.sendNotification(message, subject)
  }

  /**
   * Öğretmene yoklama raporu gönderir
   * @param {string} teacherEmail - Öğretmen email adresi
   * @param {string} courseName - Ders adı
   * @param {number} presentCount - Var olan öğrenci sayısı
   * @param {number} totalCount - Toplam öğrenci sayısı
   * @returns {Promise<object>} - SNS yanıtı
   */
  async sendAttendanceReport(teacherEmail, courseName, presentCount, totalCount) {
    const message = `Sayın öğretmenimiz, ${courseName} dersi için bugünkü yoklama raporu: ${presentCount}/${totalCount} öğrenci derse katıldı.`
    const subject = "Yoklama Raporu"

    return await this.sendNotification(message, subject)
  }
}

module.exports = new SNSService()
