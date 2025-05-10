// Konum doğrulama servisi
import { query } from "./db-config.js"

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

// Öğrencinin konumunu doğrula
export async function verifyStudentLocation(studentLocation, courseId) {
  try {
    // Kursun beklenen konumunu veritabanından al
    const sql = "SELECT latitude, longitude, max_distance_km FROM course_locations WHERE course_id = ?"
    const results = await query(sql, [courseId])

    if (results.length === 0) {
      return { verified: false, reason: "Kurs konum bilgisi bulunamadı" }
    }

    const courseLocation = results[0]

    // Öğrenci konumu ile kurs konumu arasındaki mesafeyi hesapla
    const distance = calculateDistance(
      studentLocation.latitude,
      studentLocation.longitude,
      courseLocation.latitude,
      courseLocation.longitude,
    )

    // Mesafe, izin verilen maksimum mesafeden küçükse konum doğrulanır
    const verified = distance <= courseLocation.max_distance_km

    return {
      verified,
      distance,
      maxAllowedDistance: courseLocation.max_distance_km,
      reason: verified ? "Konum doğrulandı" : "Öğrenci kurs konumundan çok uzakta",
    }
  } catch (error) {
    console.error("Konum doğrulama hatası:", error)
    throw error
  }
}

// Kurs konumunu kaydet/güncelle
export async function saveCourseLocation(courseId, latitude, longitude, maxDistanceKm = 0.2) {
  try {
    const sql = `
      INSERT INTO course_locations (course_id, latitude, longitude, max_distance_km)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      latitude = VALUES(latitude),
      longitude = VALUES(longitude),
      max_distance_km = VALUES(max_distance_km)
    `

    await query(sql, [courseId, latitude, longitude, maxDistanceKm])

    return { success: true }
  } catch (error) {
    console.error("Kurs konumu kaydetme hatası:", error)
    throw error
  }
}
