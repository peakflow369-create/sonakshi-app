package com.sonakshi.app;

import android.Manifest;
import android.content.*;
import android.os.*;
import android.speech.*;
import android.speech.tts.*;
import androidx.core.content.ContextCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.*;

@CapacitorPlugin(name = "Sonakshi", permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "mic") })
public class SonakshiPlugin extends Plugin {
  private SpeechRecognizer recognizer;
  private TextToSpeech tts;
  private boolean ttsReady = false;
  private final Handler main = new Handler(Looper.getMainLooper());

  /* MacroDroid -> app text channel (registered only while the app process is alive) */
  private final BroadcastReceiver textRx = new BroadcastReceiver() {
    @Override public void onReceive(Context c, Intent i) {
      JSObject o = new JSObject();
      o.put("text", i.getStringExtra("text"));
      o.put("speak", i.getBooleanExtra("speak", false));
      o.put("prompt", i.getBooleanExtra("prompt", false));
      notifyListeners("macrodroidText", o);
    }
  };

  @Override public void load() {
    ContextCompat.registerReceiver(getContext(), textRx, new IntentFilter("com.sonakshi.TEXT"), ContextCompat.RECEIVER_EXPORTED);
  }
  @Override protected void handleOnDestroy() {
    getContext().unregisterReceiver(textRx); teardown();
  }

  /* ---------- listen(): on-device STT, resolves {text} ("" on silence) ---------- */
  @PluginMethod public void listen(PluginCall call) {
    if (getPermissionState("mic") != PermissionState.GRANTED) { requestPermissionForAlias("mic", call, "micCb"); return; }
    startListen(call);
  }
  @PermissionCallback private void micCb(PluginCall call) {
    if (getPermissionState("mic") == PermissionState.GRANTED) startListen(call); else call.resolve(new JSObject().put("text", ""));
  }

  private void startListen(PluginCall call) {
    main.post(() -> {
      if (recognizer == null) recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
      Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
          .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
          .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)   // works with data OFF if the offline pack is installed
          .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
          .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200);
      recognizer.setRecognitionListener(new RecognitionListener() {
        public void onRmsChanged(float rms) {
          float v = Math.max(0f, Math.min(1f, (rms + 2f) / 12f));
          notifyListeners("rms", new JSObject().put("level", v));
        }
        public void onPartialResults(Bundle b) {
          ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
          if (r != null && !r.isEmpty()) notifyListeners("partial", new JSObject().put("text", r.get(0)));
        }
        public void onResults(Bundle b) {
          ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
          call.resolve(new JSObject().put("text", (r == null || r.isEmpty()) ? "" : r.get(0)));
        }
        public void onError(int e) { call.resolve(new JSObject().put("text", "")); }  // no-match / timeout => sleep
        public void onReadyForSpeech(Bundle p) {} public void onBeginningOfSpeech() {} public void onBufferReceived(byte[] b) {}
        public void onEndOfSpeech() {} public void onEvent(int t, Bundle b) {}
      });
      recognizer.startListening(i);
    });
  }

  /* ---------- speak(): local TTS, resolves when finished ---------- */
  @PluginMethod public void speak(PluginCall call) {
    String text = call.getString("text", "");
    main.post(() -> {
      Runnable go = () -> {
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
          public void onStart(String id) {}
          public void onDone(String id) { call.resolve(); }
          public void onError(String id) { call.resolve(); }
        });
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "sonakshi");
      };
      if (tts == null) {
        tts = new TextToSpeech(getContext(), s -> { ttsReady = (s == TextToSpeech.SUCCESS); if (ttsReady) { tts.setLanguage(new Locale("en", "IN")); go.run(); } else call.resolve(); });
      } else go.run();
    });
  }

  /* ---------- sleep(): tell MacroDroid, free everything, resume wake word, hide UI ---------- */
  @PluginMethod public void sleep(PluginCall call) {
    main.post(() -> {
      teardown();
      getContext().sendBroadcast(new Intent("com.sonakshi.SLEEP"));            // MacroDroid: data OFF
      getContext().startService(new Intent(getContext(), WakeWordService.class).setAction(WakeWordService.ACTION_RESUME));
      getActivity().moveTaskToBack(true);
      call.resolve();
    });
  }

  private void teardown() {
    if (recognizer != null) { recognizer.destroy(); recognizer = null; }
    if (tts != null) { tts.stop(); tts.shutdown(); tts = null; ttsReady = false; }
  }
}
