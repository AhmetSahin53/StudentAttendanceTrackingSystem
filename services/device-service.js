const crypto = require("crypto")
const rdsService = require("./rds-service")

/**
 * Cihaz servisini yöneten sınıf
 */
class DeviceService {
  constructor() {
    // Cihaz bilgilerini saklamak için tablo oluştur
    this.initializeDeviceTable()
  }

  /**
   * Cihaz tablosunu oluşturur
   */
  async initializeDeviceTable() {
    try {
      await rdsService.query(`
        CREATE TABLE IF NOT EXISTS devices (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          device_id VARCHAR(255) NOT NULL,
          device_name VARCHAR(255),
          device_type VARCHAR(50),
          last_login DATETIME,
          is_trusted BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          UNIQUE KEY unique_device (user_id, device_id)
        )
      `)
      console.log("Cihaz tablosu oluşturuldu veya zaten mevcut")
    } catch (error) {
      console.error(`Cihaz tablosu oluşturulurken hata oluştu: ${error.message}`)
    }
  }

  /**
   * Cihaz kimliği oluşturur
   * @param {object} deviceInfo - Cihaz bilgileri
   * @returns {string} - Cihaz kimliği
   */
  generateDeviceId(deviceInfo) {
    const deviceData = JSON.stringify(deviceInfo)
    return crypto.createHash("sha256").update(deviceData).digest("hex")
  }

  /**
   * Cihazı kaydeder
   * @param {number} userId - Kullanıcı ID'si
   * @param {string} deviceId - Cihaz kimliği
   * @param {string} deviceName - Cihaz adı
   * @param {string} deviceType - Cihaz tipi
   * @returns {Promise<object>} - Kayıt sonucu
   */
  async registerDevice(userId, deviceId, deviceName, deviceType) {
    try {
      const result = await rdsService.query(
        `INSERT INTO devices (user_id, device_id, device_name, device_type, last_login) 
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE device_name = ?, device_type = ?, last_login = NOW()`,
        [userId, deviceId, deviceName, deviceType, deviceName, deviceType],
      )
      return result
    } catch (error) {
      console.error(`Cihaz kaydedilirken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Kullanıcının cihazlarını getirir
   * @param {number} userId - Kullanıcı ID'si
   * @returns {Promise<Array>} - Cihazlar listesi
   */
  async getUserDevices(userId) {
    try {
      return await rdsService.query("SELECT * FROM devices WHERE user_id = ? ORDER BY last_login DESC", [userId])
    } catch (error) {
      console.error(`Kullanıcı cihazları alınırken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Cihazın güvenilir olup olmadığını kontrol eder
   * @param {number} userId - Kullanıcı ID'si
   * @param {string} deviceId - Cihaz kimliği
   * @returns {Promise<boolean>} - Cihaz güvenilir mi?
   */
  async isDeviceTrusted(userId, deviceId) {
    try {
      const devices = await rdsService.query("SELECT is_trusted FROM devices WHERE user_id = ? AND device_id = ?", [
        userId,
        deviceId,
      ])
      return devices.length > 0 && devices[0].is_trusted
    } catch (error) {
      console.error(`Cihaz güvenilirliği kontrol edilirken hata oluştu: ${error.message}`)
      return false
    }
  }

  /**
   * Cihazı güvenilir olarak işaretler
   * @param {number} userId - Kullanıcı ID'si
   * @param {string} deviceId - Cihaz kimliği
   * @returns {Promise<object>} - Güncelleme sonucu
   */
  async trustDevice(userId, deviceId) {
    try {
      return await rdsService.query("UPDATE devices SET is_trusted = TRUE WHERE user_id = ? AND device_id = ?", [
        userId,
        deviceId,
      ])
    } catch (error) {
      console.error(`Cihaz güvenilir olarak işaretlenirken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Cihazı güvenilmez olarak işaretler
   * @param {number} userId - Kullanıcı ID'si
   * @param {string} deviceId - Cihaz kimliği
   * @returns {Promise<object>} - Güncelleme sonucu
   */
  async untrustDevice(userId, deviceId) {
    try {
      return await rdsService.query("UPDATE devices SET is_trusted = FALSE WHERE user_id = ? AND device_id = ?", [
        userId,
        deviceId,
      ])
    } catch (error) {
      console.error(`Cihaz güvenilmez olarak işaretlenirken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Cihazı siler
   * @param {number} userId - Kullanıcı ID'si
   * @param {string} deviceId - Cihaz kimliği
   * @returns {Promise<object>} - Silme sonucu
   */
  async removeDevice(userId, deviceId) {
    try {
      return await rdsService.query("DELETE FROM devices WHERE user_id = ? AND device_id = ?", [userId, deviceId])
    } catch (error) {
      console.error(`Cihaz silinirken hata oluştu: ${error.message}`)
      throw error
    }
  }
}

module.exports = new DeviceService()
