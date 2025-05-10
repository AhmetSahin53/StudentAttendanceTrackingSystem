const express = require("express")
const router = express.Router()
const mysql = require("mysql2/promise")
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3")
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns")

// AWS yapılandırması
const AWS_REGION = process.env.AWS_REGION || "eu-central-1"
const s3Client = new S3Client({ region: AWS_REGION })
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

// Yoklama kaydı oluşturma
router.post("/record", async (req, res) => {
  try {
    const { studentId, courseId, locationData, deviceInfo } = req.body

    // Konum doğrulama (basit bir örnek)
    const locationVerified = await verifyLocation(courseId, locationData)

    if (!locationVerified) {
      return res.status(400).json({
        success: false,
        message: "Konum doğrulanamadı. Dersin yapıldığı yerde olduğunuzdan emin olun.",
      })
    }

    // Cihaz bilgilerini kaydet
    await registerDevice(studentId, deviceInfo)

    // Yoklama kaydı oluştur
    const today = new Date().toISOString().split("T")[0]
    const [result] = await pool.execute(
      'INSERT INTO attendance (student_id, course_id, date, status, location_data, device_info) VALUES (?, ?, ?, "present", ?, ?) ON DUPLICATE KEY UPDATE status = "present", location_data = ?, device_info = ?',
      [
        studentId,
        courseId,
        today,
        JSON.stringify(locationData),
        JSON.stringify(deviceInfo),
        JSON.stringify(locationData),
        JSON.stringify(deviceInfo),
      ],
    )

    // Bildirim gönder (öğretmene)
    await sendAttendanceNotification(studentId, courseId)

    res.json({
      success: true,
      message: "Yoklama başarıyla kaydedildi",
      locationVerified,
    })
  } catch (error) {
    console.error("Yoklama kaydı hatası:", error)
    res.status(500).json({ success: false, message: "Sunucu hatası" })
  }
})

// Yoklama raporu oluşturma ve S3'e yükleme
router.post("/report", async (req, res) => {
  try {
    const { courseId, startDate, endDate } = req.body

    // Yoklama verilerini getir
    const [attendanceData] = await pool.execute(
      `SELECT a.*, u.full_name as student_name, c.course_name
       FROM attendance a
       JOIN users u ON a.student_id = u.id
       JOIN courses c ON a.course_id = c.id
       WHERE a.course_id = ? AND a.date BETWEEN ? AND ?`,
      [courseId, startDate, endDate],
    )

    // Rapor içeriğini oluştur (CSV formatında)
    let reportContent = "Öğrenci ID,Öğrenci Adı,Kurs ID,Kurs Adı,Durum,Tarih\n"

    attendanceData.forEach((record) => {
      reportContent += `${record.student_id},${record.student_name},${record.course_id},${record.course_name},${record.status},${record.date}\n`
    })

    // Raporu S3'e yükle
    const fileName = `reports/attendance_${courseId}_${startDate.replace(/-/g, "")}_${endDate.replace(/-/g, "")}.csv`
    const uploadResult = await uploadToS3(Buffer.from(reportContent), fileName, "text/csv")

    res.json({
      success: true,
      reportUrl: uploadResult.url,
      recordCount: attendanceData.length,
    })
  } catch (error) {
    console.error("Yoklama raporu hatası:", error)
    res.status(500).json({ success: false, message: "Sunucu hatası" })
  }
})

// S3'e dosya yükleme yardımcı fonksiyonu
async function uploadToS3(fileBuffer, fileName, contentType) {
  const BUCKET_NAME = process.env.S3_BUCKET_NAME

  const params = {
    Bucket: BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer,
    ContentType: contentType,
  }

  try {
    const command = new PutObjectCommand(params)
    await s3Client.send(command)
    return {
      success: true,
      key: fileName,
      url: `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${fileName}`,
    }
  } catch (error) {
    console.error("S3 yükleme hatası:", error)
    throw error
  }
}

// Konum doğrulama yardımcı fonksiyonu
async function verifyLocation(courseId, locationData) {
  try {
    // Burada gerçek bir konum doğrulama mantığı olacak
    // Şimdilik basit bir kontrol yapıyoruz
    if (!locationData || !locationData.latitude || !locationData.longitude) {
      return false
    }

    // Kursun beklenen konumunu veritabanından al
    // Bu kısım, veritabanınıza course_locations tablosunu eklemenizi gerektirir
    const [locations] = await pool.execute(
      "SELECT latitude, longitude, max_distance_km FROM course_locations WHERE course_id = ?",
      [courseId],
    )

    // Eğer kurs için konum tanımlanmamışsa, doğrulamayı geç
    if (locations.length === 0) {
      return true
    }

    const courseLocation = locations[0]

    // İki konum arasındaki mesafeyi hesapla
    const distance = calculateDistance(
      locationData.latitude,
      locationData.longitude,
      courseLocation.latitude,
      courseLocation.longitude,
    )

    // Mesafe, izin verilen maksimum mesafeden küçükse konum doğrulanır
    return distance <= (courseLocation.max_distance_km || 0.2) // Varsayılan 200 metre
  } catch (error) {
    console.error("Konum doğrulama hatası:", error)
    return true // Hata durumunda doğrulamayı geç
  }
}

// İki konum arasındaki mesafeyi hesaplama (Haversine formülü)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371 // Dünya yarıçapı (km)
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = R * c // Kilometre cinsinden mesafe
  return distance
}

// Cihaz kaydı yardımcı fonksiyonu
async function registerDevice(studentId, deviceInfo) {
  try {
    // Cihaz bilgilerini JSON olarak sakla
    const deviceData = JSON.stringify(deviceInfo || {})

    // Bu kısım, veritabanınıza student_devices tablosunu eklemenizi gerektirir
    await pool.execute(
      `INSERT INTO student_devices (student_id, device_info, last_used) 
       VALUES (?, ?, NOW()) 
       ON DUPLICATE KEY UPDATE device_info = ?, last_used = NOW(), use_count = use_count + 1`,
      [studentId, deviceData, deviceData],
    )

    return true
  } catch (error) {
    console.error("Cihaz kayıt hatası:", error)
    return false
  }
}

// Yoklama bildirimi gönderme
async function sendAttendanceNotification(studentId, courseId) {
  try {
    // Öğrenci ve kurs bilgilerini al
    const [students] = await pool.execute("SELECT full_name FROM users WHERE id = ?", [studentId])

    const [courses] = await pool.execute("SELECT course_name, teacher_id FROM courses WHERE id = ?", [courseId])

    if (students.length === 0 || courses.length === 0) {
      return false
    }

    const student = students[0]
    const course = courses[0]

    // Öğretmenin SNS Topic ARN'sini al (veya oluştur)
    const topicArn = process.env.SNS_DEFAULT_TOPIC_ARN

    if (!topicArn) {
      return false
    }

    // Bildirim mesajını oluştur
    const message = `Öğrenci ${student.full_name}, ${course.course_name} dersine katıldı.`

    // SNS ile bildirim gönder
    const command = new PublishCommand({
      TopicArn: topicArn,
      Message: message,
      Subject: "Yoklama Bildirimi",
    })

    await snsClient.send(command)
    return true
  } catch (error) {
    console.error("Bildirim gönderme hatası:", error)
    return false
  }
}

module.exports = router
