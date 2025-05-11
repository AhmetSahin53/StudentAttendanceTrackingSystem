const { GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3")
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner")
const { s3Client, S3_BUCKET_NAME } = require("../aws-config")
const fs = require("fs")
const path = require("path")

/**
 * S3 servisini yöneten sınıf
 */
class S3Service {
  /**
   * S3 bucket'tan bir dosya alır
   * @param {string} key - S3 içindeki dosya yolu
   * @returns {Promise<Buffer>} - Dosya içeriği
   */
  async getFile(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key,
      })

      const response = await s3Client.send(command)
      return await streamToBuffer(response.Body)
    } catch (error) {
      console.error(`S3'ten dosya alınırken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * S3 bucket'a bir dosya yükler
   * @param {string} key - S3 içinde kaydedilecek dosya yolu
   * @param {Buffer|string} content - Dosya içeriği
   * @param {string} contentType - Dosya MIME tipi
   * @returns {Promise<string>} - Yüklenen dosyanın URL'i
   */
  async uploadFile(key, content, contentType) {
    try {
      const command = new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key,
        Body: content,
        ContentType: contentType,
        // ACL: "public-read" kaldırıldı - bucket ACL'lere izin vermiyor
      })

      await s3Client.send(command)

      // Dosyaya erişim için imzalı URL oluştur (1 gün geçerli)
      const signedUrl = await this.getSignedUrl(key, 86400) // 24 saat = 86400 saniye
      return signedUrl
    } catch (error) {
      console.error(`S3'e dosya yüklenirken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Bir dosya için geçici URL oluşturur
   * @param {string} key - S3 içindeki dosya yolu
   * @param {number} expiresIn - URL'in geçerlilik süresi (saniye)
   * @returns {Promise<string>} - Geçici URL
   */
  async getSignedUrl(key, expiresIn = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key,
      })

      return await getSignedUrl(s3Client, command, { expiresIn })
    } catch (error) {
      console.error(`İmzalı URL oluşturulurken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Statik dosyaları S3'e yükler
   * @param {string} localDir - Yerel dizin yolu
   * @param {string} s3Prefix - S3 içindeki önek
   * @returns {Promise<Array>} - Yüklenen dosyaların listesi
   */
  async uploadStaticFiles(localDir, s3Prefix = "") {
    try {
      const uploadedFiles = []
      const files = await this.getAllFiles(localDir)

      for (const file of files) {
        const relativePath = path.relative(localDir, file)
        const s3Key = path.join(s3Prefix, relativePath).replace(/\\/g, "/")
        const contentType = this.getContentType(file)
        const fileContent = fs.readFileSync(file)

        await this.uploadFile(s3Key, fileContent, contentType)
        uploadedFiles.push(s3Key)
      }

      return uploadedFiles
    } catch (error) {
      console.error(`Statik dosyalar yüklenirken hata oluştu: ${error.message}`)
      throw error
    }
  }

  /**
   * Bir dizindeki tüm dosyaları recursive olarak alır
   * @param {string} dir - Dizin yolu
   * @returns {Promise<Array<string>>} - Dosya yollarının listesi
   */
  async getAllFiles(dir) {
    const files = []

    const items = fs.readdirSync(dir, { withFileTypes: true })

    for (const item of items) {
      const fullPath = path.join(dir, item.name)
      if (item.isDirectory()) {
        files.push(...(await this.getAllFiles(fullPath)))
      } else {
        files.push(fullPath)
      }
    }

    return files
  }

  /**
   * Dosya uzantısına göre MIME tipini belirler
   * @param {string} filePath - Dosya yolu
   * @returns {string} - MIME tipi
   */
  getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    const contentTypes = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".csv": "text/csv",
      ".pdf": "application/pdf",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }

    return contentTypes[ext] || "application/octet-stream"
  }
}

/**
 * Stream'i Buffer'a dönüştürür
 * @param {ReadableStream} stream - Okunabilir stream
 * @returns {Promise<Buffer>} - Buffer
 */
async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on("data", (chunk) => chunks.push(chunk))
    stream.on("end", () => resolve(Buffer.concat(chunks)))
    stream.on("error", reject)
  })
}

module.exports = new S3Service()
