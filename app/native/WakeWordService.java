package com.sonakshi.app;

import android.app.*;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import ai.picovoice.porcupine.PorcupineManager;
import ai.picovoice.porcupine.PorcupineManagerCallback;

/** Always-on foreground service. Holds ONE Porcupine instance; start()/stop() only toggles the mic. */
public class WakeWordService extends Service {
  public static final String ACTION_RESUME = "com.sonakshi.RESUME";
  public static final String ACTION_WAKE = "com.sonakshi.WAKE";
  private static final String CH = "sonakshi_ears";
  private PorcupineManager porcupine;
  private boolean listening = false;

  @Override public void onCreate() {
    super.onCreate();
    NotificationManager nm = getSystemService(NotificationManager.class);
    nm.createNotificationChannel(new NotificationChannel(CH, "Sonakshi wake word", NotificationManager.IMPORTANCE_MIN));
    Notification n = new NotificationCompat.Builder(this, CH)
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setContentTitle("Sonakshi is standing by").setOngoing(true).build();
    if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
    else startForeground(1, n);

    try {
      porcupine = new PorcupineManager.Builder()
          .setAccessKey(BuildConfig.PICOVOICE_KEY)
          .setKeywordPath("sonakshi_android.ppn")   // from src/main/assets/
          .setSensitivity(0.65f)                     // raise for fewer misses, lower for fewer false wakes
          .build(getApplicationContext(), (PorcupineManagerCallback) idx -> onWake());
      startListening();
    } catch (Exception e) { stopSelf(); }
  }

  private void startListening() {
    if (porcupine != null && !listening) { try { porcupine.start(); listening = true; } catch (Exception ignored) {} }
  }
  private void stopListening() {
    if (porcupine != null && listening) { try { porcupine.stop(); } catch (Exception ignored) {} listening = false; }
  }

  private void onWake() {
    stopListening();                                // release the mic for SpeechRecognizer
    sendBroadcast(new Intent(ACTION_WAKE));         // MacroDroid: Intent Received trigger
  }

  @Override public int onStartCommand(Intent i, int flags, int id) {
    if (i != null && ACTION_RESUME.equals(i.getAction())) startListening();
    return START_STICKY;
  }
  @Override public void onDestroy() { stopListening(); if (porcupine != null) porcupine.delete(); super.onDestroy(); }
  @Override public IBinder onBind(Intent i) { return null; }
}
