const rdsService = require("./rds-service")
const snsService = require("./sns-service")
const fs = require("fs").promises
const path = require("path")
const PDFDocument = require("pdfkit")
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
   * Raporu PDF dosyası olarak oluşturur
   * @param {number} courseId - Ders ID'si
   * @returns {Promise<string>} - PDF dosya URL'i
   */
  async generatePDFReport(courseId) {
    try {
      const report = await this.generateAttendanceReport(courseId)
      const tempDir = path.join(__dirname, "../temp")

      // Temp dizini oluştur (yoksa)
      try {
        await fs.mkdir(tempDir, { recursive: true })
      } catch (err) {
        console.log("Temp dizini zaten var veya oluşturulamadı:", err)
      }

      const fileName = `attendance_report_${courseId}_${Date.now()}.pdf`
      const filePath = path.join(tempDir, fileName)

      // PDF oluştur
      const pdfBuffer = await this.createPDF(report)

      // PDF dosyasını geçici olarak kaydet
      await fs.writeFile(filePath, pdfBuffer)

      // PDF dosyasını S3'e yükle
      const s3Key = `reports/${fileName}`
      const s3Url = await s3Service.uploadFile(s3Key, pdfBuffer, "application/pdf")

      console.log(`PDF raporu S3'e yüklendi: ${s3Url}`)

      // Geçici dosyayı sil
      try {
        await fs.unlink(filePath)
        console.log(`Geçici dosya silindi: ${filePath}`)
      } catch (err) {
        console.error(`Geçici dosya silinirken hata oluştu: ${err.message}`)
      }

      return s3Url
    } catch (error) {
      console.error(`PDF raporu oluşturulurken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * PDF dosyası oluşturur
   * @param {object} report - Rapor verileri
   * @returns {Promise<Buffer>} - PDF buffer
   */
  async createPDF(report) {
    return new Promise((resolve, reject) => {
      try {
        // Türkçe karakter desteği için fontları tanımla
        const fontPath = path.join(__dirname, "../fonts")

        // PDF oluştur - Türkçe karakter desteği için
        const doc = new PDFDocument({
          margin: 50,
          size: "A4",
          info: {
            Title: `${report.course.course_name} - Yoklama Raporu`,
            Author: "Kocaeli Üniversitesi Yoklama Sistemi",
            Subject: "Yoklama Raporu",
            Keywords: "yoklama, rapor, kocaeli üniversitesi",
            CreationDate: new Date(),
          },
        })

        // Türkçe karakter desteği için font ekle
        // Not: Bu fontlar projenizde mevcut olmalıdır
        try {
          doc.registerFont("Regular", path.join(fontPath, "DejaVuSans.ttf"))
          doc.registerFont("Bold", path.join(fontPath, "DejaVuSans-Bold.ttf"))
          doc.font("Regular")
        } catch (fontError) {
          console.warn("Özel fontlar yüklenemedi, varsayılan fontlar kullanılacak:", fontError.message)
          // Varsayılan fontları kullan
        }

        const chunks = []

        doc.on("data", (chunk) => chunks.push(chunk))
        doc.on("end", () => resolve(Buffer.concat(chunks)))
        doc.on("error", reject)

        // Başlık
        doc.fontSize(20).text(`${report.course.course_name} (${report.course.course_code})`, { align: "center" })
        doc.moveDown()
        doc.fontSize(16).text("Yoklama Raporu", { align: "center" })
        doc.moveDown(2)

        // Tarih
        doc.fontSize(12).text(`Oluşturulma Tarihi: ${new Date().toLocaleDateString("tr-TR")}`, { align: "right" })
        doc.moveDown(2)

        // Özet bilgiler
        doc.fontSize(14).text("Özet Bilgiler", { underline: true })
        doc.moveDown()
        doc.fontSize(12)

        const totalStudents = report.students.length
        const presentStudents = report.students.filter((s) => s.presentCount > 0).length
        const averageAttendance =
          report.students.reduce((sum, student) => {
            return sum + student.presentCount / student.totalCount
          }, 0) / totalStudents || 0

        doc.text(`Toplam Öğrenci Sayısı: ${totalStudents}`)
        doc.text(`Derse Katılan Öğrenci Sayısı: ${presentStudents}`)
        doc.text(`Ortalama Katılım Oranı: ${(averageAttendance * 100).toFixed(2)}%`)
        doc.moveDown(2)

        // Öğrenci bazlı katılım tablosu
        doc.fontSize(14).text("Öğrenci Katılım Oranları", { underline: true })
        doc.moveDown()

        // Tablo başlıkları
        const tableTop = doc.y
        const colWidths = [250, 100, 100]

        doc.fontSize(12).text("Öğrenci Adı", 50, tableTop)
        doc.text("Katılım", 50 + colWidths[0], tableTop)
        doc.text("Oran (%)", 50 + colWidths[0] + colWidths[1], tableTop)

        doc
          .moveTo(50, tableTop + 20)
          .lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], tableTop + 20)
          .stroke()

        // Tablo içeriği
        let rowTop = tableTop + 30

        report.students.forEach((student, i) => {
          // Sayfa sınırını kontrol et ve gerekirse yeni sayfa ekle
          if (rowTop > 700) {
            doc.addPage()
            rowTop = 50

            // Yeni sayfada tablo başlıklarını tekrar ekle
            doc.fontSize(12)
            doc.text("Öğrenci Adı", 50, rowTop)
            doc.text("Katılım", 50 + colWidths[0], rowTop)
            doc.text("Oran (%)", 50 + colWidths[0] + colWidths[1], rowTop)

            doc
              .moveTo(50, rowTop + 20)
              .lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], rowTop + 20)
              .stroke()

            rowTop += 30
          }

          // Satır arkaplan rengi (alternatif satırlar için)
          if (i % 2 === 0) {
            doc
              .rect(50, rowTop - 10, colWidths[0] + colWidths[1] + colWidths[2], 20)
              .fill("#f2f2f2")
              .fillColor("black")
          }

          // Satır verileri
          const attendanceRate = ((student.presentCount / student.totalCount) * 100).toFixed(2)

          doc.text(student.name, 50, rowTop)
          doc.text(`${student.presentCount}/${student.totalCount}`, 50 + colWidths[0], rowTop)
          doc.text(`${attendanceRate}%`, 50 + colWidths[0] + colWidths[1], rowTop)

          rowTop += 20
        })

        doc.moveDown(4)

        // Detaylı yoklama tablosu
        doc.addPage()
        doc.fontSize(14).text("Detaylı Yoklama Kayıtları", { underline: true })
        doc.moveDown()

        // Tarih başlıkları
        const dateTableTop = doc.y
        const dateColWidth = 120
        const studentColWidth = 200
        const statusColWidth = 50

        doc.fontSize(12)
        doc.text("Öğrenci Adı", 50, dateTableTop)
        doc.text("Tarih", 50 + studentColWidth, dateTableTop)
        doc.text("Durum", 50 + studentColWidth + dateColWidth, dateTableTop)

        doc
          .moveTo(50, dateTableTop + 20)
          .lineTo(50 + studentColWidth + dateColWidth + statusColWidth, dateTableTop + 20)
          .stroke()

        // Detaylı tablo içeriği
        let dateRowTop = dateTableTop + 30

        let rowIndex = 0
        report.students.forEach((student) => {
          report.dates.forEach((date) => {
            // Sayfa sınırını kontrol et ve gerekirse yeni sayfa ekle
            if (dateRowTop > 700) {
              doc.addPage()
              dateRowTop = 50

              // Yeni sayfada tablo başlıklarını tekrar ekle
              doc.fontSize(12)
              doc.text("Öğrenci Adı", 50, dateRowTop)
              doc.text("Tarih", 50 + studentColWidth, dateRowTop)
              doc.text("Durum", 50 + studentColWidth + dateColWidth, dateRowTop)

              doc
                .moveTo(50, dateRowTop + 20)
                .lineTo(50 + studentColWidth + dateColWidth + statusColWidth, dateRowTop + 20)
                .stroke()

              dateRowTop += 30
            }

            // Satır arkaplan rengi (alternatif satırlar için)
            if (rowIndex % 2 === 0) {
              doc
                .rect(50, dateRowTop - 10, studentColWidth + dateColWidth + statusColWidth, 20)
                .fill("#f2f2f2")
                .fillColor("black")
            }

            // Satır verileri
            const formattedDate = new Date(date).toLocaleDateString("tr-TR")
            const status = student.attendance[date] === "present" ? "Var" : "Yok"
            const statusColor = student.attendance[date] === "present" ? "#4CAF50" : "#F44336"

            doc.text(student.name, 50, dateRowTop)
            doc.text(formattedDate, 50 + studentColWidth, dateRowTop)

            // Durum renkli olarak göster
            doc.fillColor(statusColor)
            doc.text(status, 50 + studentColWidth + dateColWidth, dateRowTop)
            doc.fillColor("black") // Rengi siyaha geri döndür

            dateRowTop += 20
            rowIndex++
          })
        })

        // Altbilgi
        doc
          .fontSize(10)
          .text(
            `Bu rapor ${new Date().toLocaleString("tr-TR")} tarihinde otomatik olarak oluşturulmuştur.`,
            50,
            doc.page.height - 50,
            { align: "center" },
          )

        doc.end()
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Geriye dönük uyumluluk için CSV metodunu da tutalım
   * @param {number} courseId - Ders ID'si
   * @returns {Promise<string>} - PDF dosya URL'i
   */
  async generateCSVReport(courseId) {
    return this.generatePDFReport(courseId)
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
      const pdfUrl = await this.generatePDFReport(courseId)

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
        
        Detaylı rapor için: ${pdfUrl}
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
