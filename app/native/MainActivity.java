package com.sonakshi.app;

import android.content.Intent;
import android.os.Bundle;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override public void onCreate(Bundle b) {
    registerPlugin(SonakshiPlugin.class);   // must precede super.onCreate
    super.onCreate(b);
    setShowWhenLocked(true);                // draw over the lockscreen
    setTurnScreenOn(true);                  // wake the display
    // Start the ears while the app is visible (Android 14 only allows mic-type FGS starts from a visible app).
    ContextCompat.startForegroundService(this, new Intent(this, WakeWordService.class));
  }
}
