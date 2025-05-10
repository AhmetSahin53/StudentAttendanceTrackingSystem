// Yoklama işlemleri servisi
import { query } from "./db-config.js"
import { sendNotification } from "./sns-service.js"
import { uploadFile } from "./s3-service.js"

// Yoklama kaydı oluşturma
export async function createAttendanceRecord(studentId, courseId, isPresent, locationData, deviceInfo) {
  try {
    // Yoklama kaydını veritabanına ekle
    const sql = `
      INSERT INTO attendance (student_id, course_id, is_present, location_data, device_info, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `

    const result = await query(sql, [
      studentId,
      courseId,
      isPresent ? 1 : 0,
      JSON.stringify(locationData),
      JSON.stringify(deviceInfo),
    ])

    // Yoklama durumuna göre bildirim gönder
    if (!isPresent) {
      // Devamsızlık durumunda bildirim gönder
      const message = `Öğrenci ID: ${studentId}, ${new Date().toLocaleDateString()} tarihinde ${courseId} dersine katılmadı.`
      await sendAbsenceNotification(studentId, courseId, message)
    }

    return {
      success: true,
      attendanceId: result.insertId,
    }
  } catch (error) {
    console.error("Yoklama kaydı oluşturma hatası:", error)
    throw error
  }
}

// Devamsızlık bildirimi gönderme
async function sendAbsenceNotification(studentId, courseId, message) {
  try {
    // Kurs yöneticisinin SNS Topic ARN'sini al
    const courseManagerTopicArn = await getCourseManagerTopicArn(courseId)

    if (courseManagerTopicArn) {
      // Bildirim gönder
      await sendNotification(courseManagerTopicArn, message, "Devamsızlık Bildirimi")

      // Bildirim kaydını veritabanına ekle
      await saveNotificationRecord(studentId, courseId, message)
    }
  } catch (error) {
    console.error("Devamsızlık bildirimi gönderme hatası:", error)
  }
}

// Kurs yöneticisinin SNS Topic ARN'sini getir
async function getCourseManagerTopicArn(courseId) {
  try {
    const sql = "SELECT notification_topic_arn FROM courses WHERE id = ?"
    const results = await query(sql, [courseId])

    if (results.length > 0 && results[0].notification_topic_arn) {
      return results[0].notification_topic_arn
    }

    // Varsayılan topic ARN'yi döndür
    return process.env.SNS_DEFAULT_TOPIC_ARN
  } catch (error) {
    console.error("Kurs yöneticisi topic ARN getirme hatası:", error)
    throw error
  }
}

// Bildirim kaydını veritabanına ekle
async function saveNotificationRecord(studentId, courseId, message) {
  try {
    const sql = `
      INSERT INTO notifications (student_id, course_id, message, created_at)
      VALUES (?, ?, ?, NOW())
    `

    await query(sql, [studentId, courseId, message])
  } catch (error) {
    console.error("Bildirim kaydı ekleme hatası:", error)
  }
}

// Yoklama raporu oluşturma ve S3'e yükleme
export async function generateAttendanceReport(courseId, startDate, endDate) {
  try {
    // Yoklama verilerini getir
    const sql = `
      SELECT a.*, s.name as student_name, c.name as course_name
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN courses c ON a.course_id = c.id
      WHERE a.course_id = ? AND a.created_at BETWEEN ? AND ?
    `

    const attendanceData = await query(sql, [courseId, startDate, endDate])

    // Rapor içeriğini oluştur (CSV formatında)
    let reportContent = "Öğrenci ID,Öğrenci Adı,Ders ID,Ders Adı,Durum,Tarih\n"

    attendanceData.forEach((record) => {
      reportContent += `${record.student_id},${record.student_name},${record.course_id},${record.course_name},${record.is_present ? "Katıldı" : "Katılmadı"},${new Date(record.created_at).toLocaleDateString()}\n`
    })

    // Raporu S3'e yükle
    const fileName = `reports/attendance_${courseId}_${startDate.replace(/-/g, "")}_${endDate.replace(/-/g, "")}.csv`
    const uploadResult = await uploadFile(Buffer.from(reportContent), fileName, "text/csv")

    return {
      success: true,
      reportUrl: uploadResult.url,
      recordCount: attendanceData.length,
    }
  } catch (error) {
    console.error("Yoklama raporu oluşturma hatası:", error)
    throw error
  }
}
