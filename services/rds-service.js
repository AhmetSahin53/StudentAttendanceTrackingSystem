const mysql = require("mysql2/promise")

/**
 * RDS veritabanı servisini yöneten sınıf
 */
class RDSService {
  constructor() {
    this.pool = null
    this.initializePool()
  }

  /**
   * Veritabanı bağlantı havuzunu başlatır
   */
  initializePool() {
    this.pool = mysql.createPool({
      host: process.env.RDS_HOSTNAME || "localhost",
      user: process.env.RDS_USERNAME || "root",
      password: process.env.RDS_PASSWORD || "sanane53",
      database: process.env.RDS_DB_NAME || "attendance_system2",
      port: process.env.RDS_PORT || 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    })
  }

  /**
   * Veritabanı sorgusu çalıştırır
   * @param {string} sql - SQL sorgusu
   * @param {Array} params - Sorgu parametreleri
   * @returns {Promise<Array>} - Sorgu sonuçları
   */
  async query(sql, params = []) {
    try {
      const [results] = await this.pool.execute(sql, params)
      return results
    } catch (error) {
      console.error(`Veritabanı sorgusu çalıştırılırken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Veritabanı bağlantısını kapatır
   */
  async close() {
    if (this.pool) {
      await this.pool.end()
    }
  }

  /**
   * Kullanıcıyı kullanıcı adına göre getirir
   * @param {string} username - Kullanıcı adı
   * @returns {Promise<object|null>} - Kullanıcı bilgileri
   */
  async getUserByUsername(username) {
    const users = await this.query("SELECT * FROM users WHERE username = ?", [username])
    return users.length > 0 ? users[0] : null
  }

  /**
   * Yeni kullanıcı oluşturur
   * @param {object} userData - Kullanıcı verileri
   * @returns {Promise<number>} - Eklenen kullanıcının ID'si
   */
  async createUser(userData) {
    const { username, password, full_name, role } = userData
    const result = await this.query("INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)", [
      username,
      password,
      full_name,
      role,
    ])
    return result.insertId
  }

  /**
   * Öğretmenin derslerini getirir
   * @param {number} teacherId - Öğretmen ID'si
   * @returns {Promise<Array>} - Dersler listesi
   */
  async getTeacherCourses(teacherId) {
    return await this.query("SELECT * FROM courses WHERE teacher_id = ?", [teacherId])
  }

  /**
   * Öğrencinin derslerini getirir
   * @param {number} studentId - Öğrenci ID'si
   * @returns {Promise<Array>} - Dersler listesi
   */
  async getStudentCourses(studentId) {
    return await this.query(
      `SELECT c.* FROM courses c
       JOIN enrollments e ON c.id = e.course_id
       WHERE e.student_id = ?`,
      [studentId],
    )
  }

  /**
   * Bir dersin yoklama kayıtlarını getirir
   * @param {number} courseId - Ders ID'si
   * @returns {Promise<Array>} - Yoklama kayıtları
   */
  async getCourseAttendance(courseId) {
    return await this.query(
      `SELECT u.full_name, a.date, a.status
       FROM attendance a
       JOIN users u ON a.student_id = u.id
       WHERE a.course_id = ?
       ORDER BY a.date DESC, u.full_name`,
      [courseId],
    )
  }

  /**
   * Bir derse kayıtlı öğrencileri getirir
   * @param {number} courseId - Ders ID'si
   * @returns {Promise<Array>} - Öğrenciler listesi
   */
  async getCourseStudents(courseId) {
    return await this.query(
      `SELECT u.id, u.full_name, 
       (SELECT COUNT(*) FROM attendance a WHERE a.student_id = u.id AND a.course_id = ? AND a.status = 'present') as present_count
       FROM users u
       JOIN enrollments e ON u.id = e.student_id
       WHERE e.course_id = ? AND u.role = 'student'`,
      [courseId, courseId],
    )
  }

  /**
   * Yoklama kaydı ekler
   * @param {number} studentId - Öğrenci ID'si
   * @param {number} courseId - Ders ID'si
   * @param {string} date - Tarih
   * @param {string} status - Durum (present/absent)
   * @returns {Promise<object>} - Ekleme sonucu
   */
  async addAttendance(studentId, courseId, date, status = "present") {
    return await this.query(
      "INSERT INTO attendance (student_id, course_id, date, status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = ?",
      [studentId, courseId, date, status, status],
    )
  }
}

module.exports = new RDSService()
