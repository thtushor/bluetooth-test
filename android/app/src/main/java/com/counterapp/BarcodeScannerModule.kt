package com.counterapp

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class ScannerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var scanPromise: Promise? = null

    private val activityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode == 1001) {
                if (resultCode == Activity.RESULT_OK) {
                    val result = data?.getStringExtra("SCAN_RESULT")
                    scanPromise?.resolve(result)
                } else {
                    scanPromise?.reject("SCAN_CANCELLED", "Scanner closed by user")
                }
                scanPromise = null
            }
        }
    }

    init {
        reactContext.addActivityEventListener(activityEventListener)
    }

    override fun getName(): String = "BarcodeScannerModule"

    @ReactMethod
    fun startScan(promise: Promise) {
        val currentActivity = currentActivity
        if (currentActivity == null) {
            promise.reject("ACTIVITY_NOT_FOUND", "Activity doesn't exist")
            return
        }

        scanPromise = promise

        val intent = Intent(currentActivity, ScannerActivity::class.java)
        currentActivity.startActivityForResult(intent, 1001)
    }
}
