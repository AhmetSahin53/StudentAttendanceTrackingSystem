const rdsService = require("./rds-service")
const snsService = require("./sns-service")
const fs = require("fs").promises
const path = require("path")
const { createObjectCsvWriter } = require("csv-writer")
const s3Service = require("./s3-service")

/**
 * Rapor servisini yöneten sınıf
 */
class ReportService {
  /**
   * Bir ders için yoklama raporu oluşturur
   * @param {number} courseId - Ders ID'si
   * @returns {Promise<object>} - Rapor verileri
   */
  async generateAttendanceReport(courseId) {
    try {
      // Ders bilgilerini al
      const courses = await rdsService.query("SELECT * FROM courses WHERE id = ?", [courseId])
      if (courses.length === 0) {
        throw new Error("Ders bulunamadı")
      }
      const course = courses[0]

      // Yoklama kayıtlarını al
      const attendanceRecords = await rdsService.getCourseAttendance(courseId)

      // Öğrenci listesini al
      const students = await rdsService.getCourseStudents(courseId)

      // Tarih listesini oluştur
      const dates = [...new Set(attendanceRecords.map((record) => record.date.toISOString().split("T")[0]))]
      dates.sort((a, b) => new Date(b) - new Date(a)) // Tarihleri yeniden eskiye sırala

      // Öğrenci bazlı yoklama verilerini oluştur
      const studentAttendance = {}
      students.forEach((student) => {
        studentAttendance[student.id] = {
          name: student.full_name,
          attendance: {},
          presentCount: 0,
          totalCount: dates.length,
        }

        dates.forEach((date) => {
          studentAttendance[student.id].attendance[date] = "absent"
        })
      })

      // Yoklama kayıtlarını işle
      attendanceRecords.forEach((record) => {
        const date = record.date.toISOString().split("T")[0]
        const studentId = record.student_id
        if (studentAttendance[studentId]) {
          studentAttendance[studentId].attendance[date] = record.status
          if (record.status === "present") {
            studentAttendance[studentId].presentCount++
          }
        }
      })

      return {
        course,
        dates,
        students: Object.values(studentAttendance),
        totalDates: dates.length,
      }
    } catch (error) {
      console.error(`Yoklama raporu oluşturulurken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Raporu CSV dosyası olarak oluşturur
   * @param {number} courseId - Ders ID'si
   * @returns {Promise<string>} - CSV dosya yolu
   */
  async generateCSVReport(courseId) {
    try {
      const report = await this.generateAttendanceReport(courseId)
      const tempDir = path.join(__dirname, "../temp")
      await fs.mkdir(tempDir, { recursive: true })

      const fileName = `attendance_report_${courseId}_${Date.now()}.csv`
      const filePath = path.join(tempDir, fileName)

      // CSV başlıklarını oluştur
      const headers = [
        { id: "name", title: "Öğrenci Adı" },
        ...report.dates.map((date) => ({
          id: `date_${date}`,
          title: new Date(date).toLocaleDateString("tr-TR"),
        })),
        { id: "presentCount", title: "Katılım Sayısı" },
        { id: "attendanceRate", title: "Katılım Oranı (%)" },
      ]

      // CSV verilerini oluştur
      const records = report.students.map((student) => {
        const record = {
          name: student.name,
          presentCount: student.presentCount,
          attendanceRate: ((student.presentCount / student.totalCount) * 100).toFixed(2),
        }

        report.dates.forEach((date) => {
          record[`date_${date}`] = student.attendance[date] === "present" ? "Var" : "Yok"
        })

        return record
      })

      // CSV dosyasını oluştur
      const csvWriter = createObjectCsvWriter({
        path: filePath,
        header: headers,
      })

      await csvWriter.writeRecords(records)

      // CSV dosyasını S3'e yükle
      const s3Key = `reports/${fileName}`
      const fileContent = await fs.readFile(filePath)
      const s3Url = await s3Service.uploadFile(s3Key, fileContent, "text/csv")

      // Geçici dosyayı sil
      await fs.unlink(filePath)

      return s3Url
    } catch (error) {
      console.error(`CSV raporu oluşturulurken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Raporu öğretmene gönderir
   * @param {number} courseId - Ders ID'si
   * @param {string} teacherEmail - Öğretmen email adresi
   * @returns {Promise<object>} - Gönderim sonucu
   */
  async sendReportToTeacher(courseId, teacherEmail) {
    try {
      const report = await this.generateAttendanceReport(courseId)
      const csvUrl = await this.generateCSVReport(courseId)

      // Rapor özetini oluştur
      const totalStudents = report.students.length
      const presentStudents = report.students.filter((s) => s.presentCount > 0).length
      const averageAttendance =
        report.students.reduce((sum, student) => sum + student.presentCount, 0) / (totalStudents * report.totalDates)

      // SNS ile bildirim gönder
      const message = `
        Ders: ${report.course.course_name} (${report.course.course_code})
        Toplam Öğrenci: ${totalStudents}
        Derse Katılan Öğrenci: ${presentStudents}
        Ortalama Katılım Oranı: ${(averageAttendance * 100).toFixed(2)}%
        
        Detaylı rapor için: ${csvUrl}
      `

      const subject = `Yoklama Raporu: ${report.course.course_name}`
      return await snsService.sendNotification(message, subject)
    } catch (error) {
      console.error(`Rapor gönderilirken hata oluştu: ${error.message}`)
      throw error
    }
  }
}

module.exports = new ReportService()
