package br.com.ferforastieri.jeff

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

class JeffMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    JeffPush.token = token
    JeffPush.deliverToken(token)
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    if (JeffPush.foreground) {
      JeffPush.deliver(data)
      return
    }
    showNotification(data)
  }

  private fun showNotification(data: Map<String, String>) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return
    }

    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Jeff",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Respostas da IA e avisos do Jeff"
      }
      manager.createNotificationChannel(channel)
    }

    val payload = JSONObject().apply {
      data.forEach { (key, value) -> put(key, value) }
      put("opened", "true")
    }
    val intent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("jeff_push", payload.toString())
    }
    val requestCode = (data["notificationId"] ?: System.currentTimeMillis().toString()).hashCode()
    val pending = PendingIntent.getActivity(
      this,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_jeff)
      .setContentTitle(data["title"] ?: "Resposta da IA")
      .setContentText(data["body"] ?: "A IA terminou de responder.")
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setContentIntent(pending)
      .build()
    manager.notify((System.currentTimeMillis() % 100000).toInt(), notification)
  }

  companion object {
    private const val CHANNEL_ID = "jeff_ai"
  }
}
