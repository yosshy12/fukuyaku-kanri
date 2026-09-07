package jp.yosshy12.fukuyakukanri.backup

import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class DriveApiClient(private val accessToken: String) {
    fun uploadBackup(folderName: String, file: File, mimeType: String) {
        val folderId = findOrCreateFolder(folderName)
        val metadata = JSONObject()
            .put("name", file.name)
            .put("parents", org.json.JSONArray().put(folderId))
        val boundary = "fukuyaku-${System.currentTimeMillis()}"
        val connection = open("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", "POST")
        connection.setRequestProperty("Content-Type", "multipart/related; boundary=$boundary")
        connection.doOutput = true
        connection.outputStream.use { output ->
            output.write("--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".toByteArray())
            output.write(metadata.toString().toByteArray(Charsets.UTF_8))
            output.write("\r\n--$boundary\r\nContent-Type: $mimeType\r\n\r\n".toByteArray())
            file.inputStream().use { it.copyTo(output) }
            output.write("\r\n--$boundary--\r\n".toByteArray())
        }
        requireSuccess(connection)
    }

    fun downloadLatestDatabase(folderName: String, destination: File): Boolean {
        val folderId = findFolder(folderName) ?: return false
        val query = "'$folderId' in parents and name contains '.sqlite3' and trashed = false"
        val url = "https://www.googleapis.com/drive/v3/files" +
            "?q=${encode(query)}&orderBy=${encode("createdTime desc")}&pageSize=1&fields=${encode("files(id,name)")}"
        val response = requireSuccess(open(url))
        val files = JSONObject(response).getJSONArray("files")
        if (files.length() == 0) return false
        val id = files.getJSONObject(0).getString("id")
        val connection = open("https://www.googleapis.com/drive/v3/files/$id?alt=media")
        if (connection.responseCode !in 200..299) requireSuccess(connection)
        destination.outputStream().use { output -> connection.inputStream.use { it.copyTo(output) } }
        return true
    }

    private fun findOrCreateFolder(name: String): String = findFolder(name) ?: run {
        val metadata = JSONObject()
            .put("name", name)
            .put("mimeType", FOLDER_MIME)
        val connection = open("https://www.googleapis.com/drive/v3/files?fields=id", "POST")
        connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
        connection.doOutput = true
        connection.outputStream.use { it.write(metadata.toString().toByteArray(Charsets.UTF_8)) }
        JSONObject(requireSuccess(connection)).getString("id")
    }

    private fun findFolder(name: String): String? {
        val escapedName = name.replace("'", "\\'")
        val query = "name = '$escapedName' and mimeType = '$FOLDER_MIME' and trashed = false"
        val url = "https://www.googleapis.com/drive/v3/files" +
            "?q=${encode(query)}&pageSize=1&fields=${encode("files(id,name)")}"
        val files = JSONObject(requireSuccess(open(url))).getJSONArray("files")
        return if (files.length() == 0) null else files.getJSONObject(0).getString("id")
    }

    private fun open(url: String, method: String = "GET"): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 20_000
            readTimeout = 60_000
            setRequestProperty("Authorization", "Bearer $accessToken")
        }

    private fun requireSuccess(connection: HttpURLConnection): String {
        val successful = connection.responseCode in 200..299
        val text = (if (successful) connection.inputStream else connection.errorStream)
            ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        if (!successful) throw IllegalStateException("Google Driveへの保存に失敗しました (${connection.responseCode})")
        return text
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    companion object {
        private const val FOLDER_MIME = "application/vnd.google-apps.folder"
    }
}
