const express = require("express")
const mysql = require("mysql2")
const session = require("express-session")
const bcrypt = require("bcrypt")
const path = require("path")
require("dotenv").config()
const PDFDocument = require("pdfkit")
console.log("AWS_REGION:", process.env.AWS_REGION)
console.log("SNS_GENERAL_TOPIC_ARN:", process.env.SNS_GENERAL_TOPIC_ARN)
console.log("SNS_TOPIC_ARN:", process.env.SNS_TOPIC_ARN)
const app = express()
const port = process.env.PORT || 4000

// AWS Servisleri
const s3Service = require("./services/s3-service")
const snsService = require("./services/sns-service")
const rdsService = require("./services/rds-service")
const deviceService = require("./services/device-service")
const locationService = require("./services/location-service")
const reportService = require("./services/report-service")

// API Routes
const apiRoutes = require("./routes/api")

// Middleware setup
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))
app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"))

// Session setup
app.use(
  session({
    secret: process.env.SESSION_SECRET || "firat-university-attendance-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 3600000 }, // 1 hour
  }),
)

// Database connection
const db = mysql.createConnection({
  host: process.env.RDS_HOSTNAME || "localhost",
  user: process.env.RDS_USERNAME || "root",
  password: process.env.RDS_PASSWORD || "sanane53",
  database: process.env.RDS_DB_NAME || "attendance_system2",
  multipleStatements: true,
})

db.connect((err) => {
  if (err) {
    console.error("Database connection failed: " + err.stack)
    return
  }
  console.log("Connected to database")

  // Create users table
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role ENUM('student', 'teacher') NOT NULL,
  email VARCHAR(100)
)

  `

  db.query(createUsersTable, (err) => {
    if (err) throw err
    console.log("Users table created or already exists")

    // Create notifications table
    const createNotificationsTable = `
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `

    db.query(createNotificationsTable, (err) => {
      if (err) {
        console.error("Error creating notifications table:", err)
      } else {
        console.log("Notifications table created or already exists")
      }
    })

    // Create courses table
    const createCoursesTable = `
      CREATE TABLE IF NOT EXISTS courses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        course_code VARCHAR(20) UNIQUE NOT NULL,
        course_name VARCHAR(100) NOT NULL,
        teacher_id INT,
        FOREIGN KEY (teacher_id) REFERENCES users(id)
      )
    `

    db.query(createCoursesTable, (err) => {
      if (err) throw err
      console.log("Courses table created or already exists")

      // Create enrollments table
      const createEnrollmentsTable = `
        CREATE TABLE IF NOT EXISTS enrollments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          student_id INT,
          course_id INT,
          FOREIGN KEY (student_id) REFERENCES users(id),
          FOREIGN KEY (course_id) REFERENCES courses(id),
          UNIQUE KEY unique_enrollment (student_id, course_id)
        )
      `

      db.query(createEnrollmentsTable, (err) => {
        if (err) throw err
        console.log("Enrollments table created or already exists")

        // Create attendance table
        const createAttendanceTable = `
          CREATE TABLE IF NOT EXISTS attendance (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT,
            course_id INT,
            date DATE NOT NULL,
            status ENUM('present', 'absent') DEFAULT 'present',
            location_lat DECIMAL(10, 8) NULL,
            location_lon DECIMAL(11, 8) NULL,
            device_id VARCHAR(255) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES users(id),
            FOREIGN KEY (course_id) REFERENCES courses(id),
            UNIQUE KEY unique_attendance (student_id, course_id, date)
          )
        `

        db.query(createAttendanceTable, (err) => {
          if (err) throw err
          console.log("Attendance table created or already exists")
        })
      })
    })
  })
})

// Authentication middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    return next()
  }
  res.redirect("/login")
}

const isTeacher = (req, res, next) => {
  if (req.session.user && req.session.user.role === "teacher") {
    return next()
  }
  res.status(403).render("error", { message: "Yetkiniz yok" })
}

// API Routes
app.use("/api", apiRoutes)

// Routes
app.get("/", (req, res) => {
  res.render("index", { user: req.session.user })
})

app.get("/login", (req, res) => {
  res.render("login", { error: null })
})

app.post("/login", (req, res) => {
  const { username, password } = req.body

  db.query("SELECT * FROM users WHERE username = ?", [username], async (err, results) => {
    if (err) throw err

    if (results.length === 0) {
      return res.render("login", { error: "Kullanıcı adı veya şifre hatalı" })
    }

    const user = results[0]
    const match = await bcrypt.compare(password, user.password)

    if (!match) {
      return res.render("login", { error: "Kullanıcı adı veya şifre hatalı" })
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
    }

    // Kullanıcı girişi bildirimini SNS ile gönder
    try {
      console.log("SNS Params:", {
        Message: `Kullanıcı ${user.full_name} (${user.username}) sisteme giriş yaptı.`,
        Subject: "Kullanıcı Girişi",
        TopicArn: process.env.SNS_TOPIC_ARN || process.env.SNS_GENERAL_TOPIC_ARN,
      })
      await snsService.sendNotification(
        `Kullanıcı ${user.full_name} (${user.username}) sisteme giriş yaptı.`,
        "Kullanıcı Girişi",
      )
    } catch (error) {
      console.error("SNS bildirimi gönderilirken hata oluştu:", error)
    }

    res.redirect("/dashboard")
  })
})

app.get("/register", (req, res) => {
  res.render("register", { error: null })
})

app.post("/register", async (req, res) => {
  const { username, password, fullName, role, email } = req.body

  try {
    const hashedPassword = await bcrypt.hash(password, 10)

    db.query(
      "INSERT INTO users (username, password, full_name, role, email) VALUES (?, ?, ?, ?, ?)",
      [username, hashedPassword, fullName, role, email],
      async (err, result) => {
        if (err) {
          if (err.code === "ER_DUP_ENTRY") {
            return res.render("register", { error: "Bu kullanıcı adı veya email zaten kullanılıyor" })
          }
          throw err
        }

        // Kullanıcı ID'sini al
        const userId = result.insertId

        // Email varsa SNS'e abone et
        if (email) {
          try {
            await snsService.subscribeEmail(email)
            console.log(`${email} adresi bildirim sistemine abone edildi`)
          } catch (snsError) {
            console.error("SNS aboneliği sırasında hata:", snsError)
            // Abonelik hatası kullanıcı kaydını engellememelidir
          }
        }

        // Bildirim oluştur ve veritabanına kaydet
        try {
          const notificationTitle = "Hoş Geldiniz"
          const notificationMessage = `Sayın ${fullName}, Kocaeli Üniversitesi Online Yoklama Sistemine hoş geldiniz!`

          // Veritabanına bildirim kaydet
          await snsService.saveNotificationToDb(userId, notificationTitle, notificationMessage, db)

          // SNS ile bildirim gönder (admin için)
          await snsService.sendNotification(
            `Yeni kullanıcı kaydı: ${fullName} (${username}) - Rol: ${role}`,
            "Yeni Kullanıcı Kaydı",
          )
        } catch (notifError) {
          console.error("Bildirim oluşturulurken hata:", notifError)
        }

        res.redirect("/login")
      },
    )
  } catch (err) {
    console.error("Kayıt işlemi sırasında hata:", err)
    res.render("register", { error: "Kayıt sırasında bir hata oluştu" })
  }
})

app.get("/dashboard", isAuthenticated, (req, res) => {
  const user = req.session.user

  if (user.role === "teacher") {
    // Get courses taught by the teacher
    db.query("SELECT * FROM courses WHERE teacher_id = ?", [user.id], (err, courses) => {
      if (err) throw err
      res.render("teacher-dashboard", { user, courses })
    })
  } else {
    // Get courses enrolled by the student
    db.query(
      `SELECT c.* FROM courses c
       JOIN enrollments e ON c.id = e.course_id
       WHERE e.student_id = ?`,
      [user.id],
      (err, courses) => {
        if (err) throw err
        res.render("student-dashboard", { user, courses })
      },
    )
  }
})

app.get("/courses", isAuthenticated, (req, res) => {
  db.query("SELECT * FROM courses", (err, courses) => {
    if (err) throw err
    res.render("courses", { user: req.session.user, courses })
  })
})

app.get("/course/:id", isAuthenticated, (req, res) => {
  const courseId = req.params.id
  const user = req.session.user

  db.query("SELECT * FROM courses WHERE id = ?", [courseId], (err, results) => {
    if (err) throw err

    if (results.length === 0) {
      return res.status(404).render("error", { message: "Kurs bulunamadı" })
    }

    const course = results[0]

    if (user.role === "teacher") {
      // Get all students enrolled in this course with their attendance
      db.query(
        `SELECT u.id, u.full_name, 
         (SELECT COUNT(*) FROM attendance a WHERE a.student_id = u.id AND a.course_id = ? AND a.status = 'present') as present_count
         FROM users u
         JOIN enrollments e ON u.id = e.student_id
         WHERE e.course_id = ? AND u.role = 'student'`,
        [courseId, courseId],
        (err, students) => {
          if (err) throw err
          res.render("course-details-teacher", { user, course, students })
        },
      )
    } else {
      // Get student's attendance for this course
      db.query(
        `SELECT a.date, a.status FROM attendance a
         WHERE a.student_id = ? AND a.course_id = ?`,
        [user.id, courseId],
        (err, attendance) => {
          if (err) throw err
          res.render("course-details-student", { user, course, attendance })
        },
      )
    }
  })
})

app.post("/enroll", isAuthenticated, (req, res) => {
  if (req.session.user.role !== "student") {
    return res.status(403).render("error", { message: "Sadece öğrenciler kursa kaydolabilir" })
  }

  const { courseId } = req.body
  const studentId = req.session.user.id

  db.query("INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)", [studentId, courseId], (err) => {
    if (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).render("error", { message: "Bu kursa zaten kayıtlısınız" })
      }
      throw err
    }

    // Kurs kaydı bildirimi SNS ile gönder
    db.query("SELECT course_name FROM courses WHERE id = ?", [courseId], (err, results) => {
      if (!err && results.length > 0) {
        try {
          snsService.sendNotification(
            `Öğrenci ${req.session.user.fullName} (${req.session.user.username}), ${results[0].course_name} dersine kaydoldu.`,
            "Kurs Kaydı",
          )
        } catch (error) {
          console.error("SNS bildirimi gönderilirken hata oluştu:", error)
        }
      }
    })

    res.redirect("/dashboard")
  })
})

app.post("/mark-attendance", isAuthenticated, (req, res) => {
  if (req.session.user.role !== "student") {
    return res.status(403).render("error", { message: "Sadece öğrenciler yoklama alabilir" })
  }

  const { courseId } = req.body
  const studentId = req.session.user.id
  const today = new Date().toISOString().split("T")[0]

  db.query(
    'INSERT INTO attendance (student_id, course_id, date, status) VALUES (?, ?, ?, "present") ON DUPLICATE KEY UPDATE status = "present"',
    [studentId, courseId, today],
    (err) => {
      if (err) throw err

      // Yoklama bildirimi SNS ile gönder
      db.query("SELECT course_name FROM courses WHERE id = ?", [courseId], (err, results) => {
        if (!err && results.length > 0) {
          try {
            snsService.sendNotification(
              `Öğrenci ${req.session.user.fullName} (${req.session.user.username}), ${results[0].course_name} dersinin yoklamasını aldı.`,
              "Yoklama Alındı",
            )
          } catch (error) {
            console.error("SNS bildirimi gönderilirken hata oluştu:", error)
          }
        }
      })

      res.redirect(`/course/${courseId}`)
    },
  )
})

app.get("/create-course", isTeacher, (req, res) => {
  res.render("create-course", { user: req.session.user, error: null })
})

app.post("/create-course", isTeacher, (req, res) => {
  const { courseCode, courseName } = req.body
  const teacherId = req.session.user.id

  db.query(
    "INSERT INTO courses (course_code, course_name, teacher_id) VALUES (?, ?, ?)",
    [courseCode, courseName, teacherId],
    (err) => {
      if (err) {
        if (err.code === "ER_DUP_ENTRY") {
          return res.render("create-course", {
            user: req.session.user,
            error: "Bu kurs kodu zaten kullanılıyor",
          })
        }
        throw err
      }

      // Yeni kurs bildirimi SNS ile gönder
      try {
        snsService.sendNotification(
          `Öğretmen ${req.session.user.fullName} (${req.session.user.username}) yeni bir ders oluşturdu: ${courseName} (${courseCode})`,
          "Yeni Ders Oluşturuldu",
        )
      } catch (error) {
        console.error("SNS bildirimi gönderilirken hata oluştu:", error)
      }

      res.redirect("/dashboard")
    },
  )
})

app.get("/attendance-report/:courseId", isTeacher, async (req, res) => {
  const courseId = req.params.courseId

  try {
    // Önce PDF raporu oluştur ve S3'e yükle
    const pdfUrl = await reportService.generatePDFReport(courseId)

    db.query(`SELECT * FROM courses WHERE id = ?`, [courseId], (err, courseResults) => {
      if (err) throw err

      if (courseResults.length === 0) {
        return res.status(404).render("error", { message: "Kurs bulunamadı" })
      }

      const course = courseResults[0]

      db.query(
        `SELECT u.full_name, a.date, a.status
           FROM attendance a
           JOIN users u ON a.student_id = u.id
           WHERE a.course_id = ?
           ORDER BY a.date DESC, u.full_name`,
        [courseId],
        (err, attendanceRecords) => {
          if (err) throw err

          // Rapor oluşturuldu bildirimi SNS ile gönder
          try {
            snsService.sendNotification(
              `Öğretmen ${req.session.user.fullName} (${req.session.user.username}) ${course.course_name} dersi için yoklama raporu görüntüledi.`,
              "Yoklama Raporu Görüntülendi",
            )
          } catch (error) {
            console.error("SNS bildirimi gönderilirken hata oluştu:", error)
          }

          res.render("attendance-report", {
            user: req.session.user,
            course,
            attendanceRecords,
            pdfUrl, // PDF dosyasının URL'ini şablona aktar
          })
        },
      )
    })
  } catch (error) {
    console.error("Rapor oluşturulurken hata:", error)
    res.status(500).render("error", {
      message: "Rapor oluşturulurken bir hata oluştu: " + error.message,
      user: req.session.user,
    })
  }
})

// CSV raporu indirme bağlantısı
app.get("/download-report/:courseId", isTeacher, async (req, res) => {
  const courseId = req.params.courseId

  try {
    const pdfUrl = await reportService.generatePDFReport(courseId)

    // Kullanıcıyı S3'teki PDF dosyasına yönlendir
    res.redirect(pdfUrl)
  } catch (error) {
    console.error("Rapor indirme hatası:", error)
    res.status(500).render("error", {
      message: "Rapor indirme sırasında bir hata oluştu: " + error.message,
      user: req.session.user,
    })
  }
})

app.get("/logout", (req, res) => {
  // Çıkış bildirimi SNS ile gönder
  if (req.session.user) {
    try {
      snsService.sendNotification(
        `Kullanıcı ${req.session.user.fullName} (${req.session.user.username}) sistemden çıkış yaptı.`,
        "Kullanıcı Çıkışı",
      )
    } catch (error) {
      console.error("SNS bildirimi gönderilirken hata oluştu:", error)
    }
  }

  req.session.destroy()
  res.redirect("/login")
})

// AWS S3 statik dosya yükleme endpoint'i
app.get("/upload-static-to-s3", isAuthenticated, isTeacher, async (req, res) => {
  try {
    const uploadedFiles = await s3Service.uploadStaticFiles(path.join(__dirname, "public"), "static")
    res.json({ success: true, uploadedFiles })
  } catch (error) {
    console.error("Statik dosyalar yüklenirken hata oluştu:", error)
    res.status(500).json({ error: "Statik dosyalar yüklenirken hata oluştu" })
  }
})

// EC2 instance metadata endpoint'i
app.get("/instance-info", isAuthenticated, async (req, res) => {
  try {
    const response = await fetch("http://169.254.169.254/latest/meta-data/instance-id")
    const instanceId = await response.text()

    const response2 = await fetch("http://169.254.169.254/latest/meta-data/placement/availability-zone")
    const availabilityZone = await response2.text()

    res.json({ instanceId, availabilityZone })
  } catch (error) {
    console.error("EC2 instance bilgileri alınırken hata oluştu:", error)
    res.json({ error: "EC2 instance bilgileri alınamadı", message: "Bu muhtemelen EC2 üzerinde çalışmıyor" })
  }
})

// Veritabanını route'larda kullanabilmek için
app.locals.db = db

// Uygulama başlatma
app.listen(port, () => {
  console.log(`Attendance system running on http://localhost:${port}`)
})
