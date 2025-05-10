const express = require("express")
const router = express.Router()
const bcrypt = require("bcrypt")
const rdsService = require("../services/rds-service")
const s3Service = require("../services/s3-service")
const snsService = require("../services/sns-service")
const locationService = require("../services/location-service")
const deviceService = require("../services/device-service")
const reportService = require("../services/report-service")

// Middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    return next()
  }
  res.status(401).json({ error: "Oturum açmanız gerekiyor" })
}

const isTeacher = (req, res, next) => {
  if (req.session.user && req.session.user.role === "teacher") {
    return next()
  }
  res.status(403).json({ error: "Bu işlem için öğretmen olmanız gerekiyor" })
}

// Kullanıcı girişi
router.post("/login", async (req, res) => {
  try {
    const { username, password, deviceInfo } = req.body

    const user = await rdsService.getUserByUsername(username)
    if (!user) {
      return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" })
    }

    const match = await bcrypt.compare(password, user.password)
    if (!match) {
      return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" })
    }

    // Cihaz bilgilerini kaydet
    if (deviceInfo) {
      const deviceId = deviceService.generateDeviceId(deviceInfo)
      await deviceService.registerDevice(
        user.id,
        deviceId,
        deviceInfo.name || "Bilinmeyen Cihaz",
        deviceInfo.type || "Bilinmeyen",
      )
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: user.role,
      },
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Sunucu hatası" })
  }
})

// Kullanıcı kaydı
router.post("/register", async (req, res) => {
  try {
    const { username, password, fullName, role } = req.body

    // Kullanıcı adı kontrolü
    const existingUser = await rdsService.getUserByUsername(username)
    if (existingUser) {
      return res.status(400).json({ error: "Bu kullanıcı adı zaten kullanılıyor" })
    }

    // Şifreyi hashle
    const hashedPassword = await bcrypt.hash(password, 10)

    // Kullanıcıyı oluştur
    const userId = await rdsService.createUser({
      username,
      password: hashedPassword,
      full_name: fullName,
      role,
    })

    res.status(201).json({
      success: true,
      user: {
        id: userId,
        username,
        fullName,
        role,
      },
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Sunucu hatası" })
  }
})

// Kullanıcı bilgilerini getir
router.get("/user", isAuthenticated, (req, res) => {
  res.json({ user: req.session.user })
})

// Kullanıcı cihazlarını getir
router.get("/user/devices", isAuthenticated, async (req, res) => {
  try {
    const devices = await deviceService.getUserDevices(req.session.user.id)
    res.json({ devices })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Sunucu hatası" })
  }
})

// Cihazı güvenilir olarak işaretle
router.post("/user/devices/trust", isAuthenticated, async (req, res) => {
  try {
    const { deviceId } = req.body
    await deviceService.trustDevice(req.session.user.id, deviceId)
    res.json({ success: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Sunucu hatası" })
  }
})

// Cihazı sil
router.delete("/user/devices/:deviceId", isAuthenticated, async (req, res) => {
  try {
    const { deviceId } = req.params
    await deviceService.removeDevice(req.session.user.id, deviceId)
    res.json({ success: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Sunucu hatası" })
  }
})

// Dersleri getir
router.get("/courses", isAuthenticated, async (req, res) => {
  try {
    let courses
    if (req.session.user.role === "teacher") {
      courses = await rdsService.getTeacherCourses(req.session.user.id)
    } else {
      courses = await rdsService.getStudentCourses(req.session.user.id)
    }
    res.json({ courses })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Sunucu hatası" })
  }
})

// Ders oluştur
router.post("/courses", isTeacher, async (req, res) => {
  try {
    const { courseCode, courseName } = req.body
    const teacherId = req.session.user.id

    const result = await rdsService.query(
      "INSERT INTO courses (course_code, course_name, teacher_id) VALUES (?, ?, ?)",
      [courseCode, courseName, teacherId],
    )

    res.status(201).json({
      success: true,
      course: {
        id: result.insertId,
        course_code: courseCode,
        course_name: courseName,
        teacher_id: teacherId,
      },
    })
  } catch (error) {
    console.error(error)
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Bu kurs kodu zaten kullanılıyor" })
    }
    res.status(500).json({ error: "Sunucu hatası" })
  }
})

// Derse kaydol
router.post("/courses/:courseId/enroll", isAuthenticated, async (req, res) => {
  try {
    if (req.session.user.role !== "student") {
      return res.status(403).json({ error: "Sadece öğrenciler kursa kaydolabilir" })
    }

    const courseId = req.params.courseId
    const studentId = req.session.user.id

    await rdsService.query("INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)", [studentId, courseId])

    res.status(201).json({ success: true })
  } catch (error) {
    console.error(error)
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Bu kursa zaten kayıtlısınız" })
    }
    res.status(500).json({ error: "Sunucu hatası" })
  }
})

// Yoklama al
router.post("/courses/:courseId/attendance", isAuthenticated, async (req, res) => {
  try {
    if (req.session.user.role !== "student") {
      return res.status(403).json({ error: "Sadece öğrenciler yoklama alabilir" })
    }

    const courseId = req.params.courseId
    const studentId = req.session.user.id
    const { latitude, longitude, deviceId } = req.body
    const today = new Date().toISOString().split("T")[0]

    // Konum doğrulaması
    if (latitude && longitude) {
      const campus = locationService.getFiratUniversityCampusCoordinates()
      const isInCampus = locationService.isUserInCampus(latitude, longitude, campus.lat, campus.lon)

      if (!isInCampus) {
        return res.status(403).json({ error: "Yoklama almak için kampüs içinde olmalısınız" })
      }
    }

    // Cihaz doğrulaması
    if (deviceId) {
      const isTrusted = await deviceService.isDeviceTrusted(studentId, deviceId)
      if (!isTrusted) {
        return res.status(403).json({ error: "Bu cihaz güvenilir olarak işaretlenmemiş" })
      }
    }

    // Yoklama kaydı
    await rdsService.addAttendance(studentId, courseId, today, "present")

    // Bildirim gönder
    const courses = await rdsService.query("SELECT * FROM courses WHERE id = ?", [courseId])
    if (courses.length > 0) {
      const course = courses[0]
      await snsService.sendAttendanceReminder(req.session.user.username, course.course_name)
    }

    res.json({ success: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Sunucu hatası" })
  }
})

// Yoklama raporu
router.get("/courses/:courseId/attendance-report", isTeacher, async (req, res) => {
  try {
    const courseId = req.params.courseId
    const report = await reportService.generateAttendanceReport(courseId)
    res.json(report)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Sunucu hatası" })
  }
})

// Yoklama raporu CSV
router.get("/courses/:courseId/attendance-report/csv", isTeacher, async (req, res) => {
  try {
    const courseId = req.params.courseId
    const csvUrl = await reportService.generateCSVReport(courseId)
    res.json({ url: csvUrl })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Sunucu hatası" })
  }
})

// Yoklama raporu gönder
router.post("/courses/:courseId/attendance-report/send", isTeacher, async (req, res) => {
  try {
    const courseId = req.params.courseId
    const { email } = req.body
    await reportService.sendReportToTeacher(courseId, email || req.session.user.username)
    res.json({ success: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Sunucu hatası" })
  }
})

// Çıkış yap
router.post("/logout", (req, res) => {
  req.session.destroy()
  res.json({ success: true })
})

module.exports = router
