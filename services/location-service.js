/**
 * Konum servisini yöneten sınıf
 */
class LocationService {
  /**
   * İki konum arasındaki mesafeyi hesaplar (Haversine formülü)
   * @param {number} lat1 - İlk konumun enlem değeri
   * @param {number} lon1 - İlk konumun boylam değeri
   * @param {number} lat2 - İkinci konumun enlem değeri
   * @param {number} lon2 - İkinci konumun boylam değeri
   * @returns {number} - Metre cinsinden mesafe
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3 // Dünya yarıçapı (metre)
    const φ1 = (lat1 * Math.PI) / 180
    const φ2 = (lat2 * Math.PI) / 180
    const Δφ = ((lat2 - lat1) * Math.PI) / 180
    const Δλ = ((lon2 - lon1) * Math.PI) / 180

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const distance = R * c

    return distance
  }

  /**
   * Kullanıcının kampüs içinde olup olmadığını kontrol eder
   * @param {number} userLat - Kullanıcının enlem değeri
   * @param {number} userLon - Kullanıcının boylam değeri
   * @param {number} campusLat - Kampüsün enlem değeri
   * @param {number} campusLon - Kampüsün boylam değeri
   * @param {number} radius - Kampüs yarıçapı (metre)
   * @returns {boolean} - Kullanıcı kampüs içinde mi?
   */
  isUserInCampus(userLat, userLon, campusLat, campusLon, radius = 500) {
    const distance = this.calculateDistance(userLat, userLon, campusLat, campusLon)
    return distance <= radius
  }

  /**
   * Kullanıcının belirli bir derslik içinde olup olmadığını kontrol eder
   * @param {number} userLat - Kullanıcının enlem değeri
   * @param {number} userLon - Kullanıcının boylam değeri
   * @param {number} classroomLat - Dersliğin enlem değeri
   * @param {number} classroomLon - Dersliğin boylam değeri
   * @param {number} radius - Derslik yarıçapı (metre)
   * @returns {boolean} - Kullanıcı derslik içinde mi?
   */
  isUserInClassroom(userLat, userLon, classroomLat, classroomLon, radius = 50) {
    const distance = this.calculateDistance(userLat, userLon, classroomLat, classroomLon)
    return distance <= radius
  }

  /**
   * Fırat Üniversitesi kampüsünün koordinatları
   * @returns {object} - Kampüs koordinatları
   */
  getFiratUniversityCampusCoordinates() {
    return {
      lat: 38.6742, // Fırat Üniversitesi'nin yaklaşık enlem değeri
      lon: 39.2032, // Fırat Üniversitesi'nin yaklaşık boylam değeri
    }
  }
}

module.exports = new LocationService()
