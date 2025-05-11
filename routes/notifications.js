const express = require("express")
const router = express.Router()

// Middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    return next()
  }
  res.redirect("/login")
}

// Bildirimler sayfasını göster
router.get("/", isAuthenticated, (req, res) => {
  const userId = req.session.user.id

  // Bildirimler tablosunu kontrol et
  req.app.locals.db.query(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
    (err, notifications) => {
      if (err) {
        console.error("Bildirimler alınırken hata:", err)
        return res.status(500).render("error", {
          message: "Bildirimler alınırken bir hata oluştu",
          user: req.session.user,
        })
      }

      res.render("notifications", {
        user: req.session.user,
        notifications: notifications || [],
      })
    },
  )
})

// Bildirimi okundu olarak işaretle
router.post("/:id/read", isAuthenticated, (req, res) => {
  const notificationId = req.params.id
  const userId = req.session.user.id

  req.app.locals.db.query(
    "UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?",
    [notificationId, userId],
    (err) => {
      if (err) {
        console.error("Bildirim okundu işaretlenirken hata:", err)
        return res.status(500).render("error", {
          message: "Bildirim okundu işaretlenirken bir hata oluştu",
          user: req.session.user,
        })
      }

      res.redirect("/notifications")
    },
  )
})

// Bildirimi sil
router.post("/:id/delete", isAuthenticated, (req, res) => {
  const notificationId = req.params.id
  const userId = req.session.user.id

  req.app.locals.db.query("DELETE FROM notifications WHERE id = ? AND user_id = ?", [notificationId, userId], (err) => {
    if (err) {
      console.error("Bildirim silinirken hata:", err)
      return res.status(500).render("error", {
        message: "Bildirim silinirken bir hata oluştu",
        user: req.session.user,
      })
    }

    res.redirect("/notifications")
  })
})

// Tüm bildirimleri okundu olarak işaretle
router.post("/read-all", isAuthenticated, (req, res) => {
  const userId = req.session.user.id

  req.app.locals.db.query("UPDATE notifications SET is_read = TRUE WHERE user_id = ?", [userId], (err) => {
    if (err) {
      console.error("Tüm bildirimler okundu işaretlenirken hata:", err)
      return res.status(500).render("error", {
        message: "Tüm bildirimler okundu işaretlenirken bir hata oluştu",
        user: req.session.user,
      })
    }

    res.redirect("/notifications")
  })
})

module.exports = router
