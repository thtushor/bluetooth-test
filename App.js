import { StatusBar } from 'expo-status-bar';
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  NativeModules,
  NativeEventEmitter,
  FlatList,
  PermissionsAndroid,
  Platform,
  Alert,
  TextInput,
  ActivityIndicator,
  SectionList
} from 'react-native';

const { BluetoothModule } = NativeModules;
// Prevent crash if native module is not yet available
const eventEmitter = BluetoothModule ? new NativeEventEmitter(BluetoothModule) : {
  addListener: () => ({ remove: () => { } }),
  removeAllListeners: () => { },
};

export default function App() {
  const [pairedDevices, setPairedDevices] = useState([]);
  const [scannedDevices, setScannedDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!BluetoothModule) {
      console.warn("BluetoothModule is null. Native build may be required.");
      return;
    }
    requestPermissions();
    fetchPairedDevices();

    const deviceFoundListener = eventEmitter.addListener('DeviceFound', (device) => {
      setScannedDevices((prevDevices) => {
        if (!prevDevices.find(d => d.address === device.address)) {
          return [...prevDevices, device];
        }
        return prevDevices;
      });
    });

    return () => {
      deviceFoundListener.remove();
    };
  }, []);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
        console.log('Permissions:', granted);
      } catch (err) {
        console.warn(err);
      }
    }
  };

  const fetchPairedDevices = async () => {
    try {
      const devices = await BluetoothModule.getPairedDevices();
      setPairedDevices(devices);
    } catch (e) {
      console.warn("Failed to fetch paired devices", e);
    }
  };

  const startScan = async () => {
    if (!BluetoothModule) {
      Alert.alert("Native Module Missing", "The native Bluetooth module is not linked. Please wait for the build to complete and reinstall the app.");
      return;
    }
    try {
      setScannedDevices([]);
      setScanning(true);
      const result = await BluetoothModule.startScan();
      console.log(result);
    } catch (e) {
      console.error(e);
      Alert.alert("Error starting scan", e.message);
      setScanning(false);
    }
  };

  const stopScan = async () => {
    try {
      await BluetoothModule.stopScan();
      setScanning(false);
      console.log("Scan stopped");
    } catch (e) {
      console.error(e);
    }
  };

  const connectToDevice = async (device) => {
    try {
      if (scanning) {
        await stopScan();
      }
      console.log(`Connecting to ${device.name}...`);
      const result = await BluetoothModule.connect(device.address);
      setConnectedDevice(device);
      Alert.alert("Connected", result);
    } catch (e) {
      Alert.alert("Connection Failed", e.message);
    }
  };

  const pairDevice = async (device) => {
    try {
      if (scanning) {
        await stopScan();
      }
      Alert.alert("Pairing", `Initiating pairing with ${device.name || device.address}`);
      await BluetoothModule.pairDevice(device.address);
      // Refresh paired devices after a delay or wait for event (for now, manual refresh or assume success/user action)
      // Ideally we should listen to BOND_STATE_CHANGED
    } catch (e) {
      Alert.alert("Pairing Failed", e.message);
    }
  };

  const disconnect = async () => {
    try {
      await BluetoothModule.disconnect();
      setConnectedDevice(null);
      Alert.alert("Disconnected");
    } catch (e) {
      console.error(e);
    }
  };

  const sendData = async () => {
    if (!connectedDevice) {
      Alert.alert("Error", "No device connected");
      return;
    }
    try {
      await BluetoothModule.sendData(message + "\n");
      setLogs(prev => [`Sent: ${message}`, ...prev]);
      setMessage('');
    } catch (e) {
      Alert.alert("Send Failed", e.message);
    }
  };

  const renderItem = ({ item }) => {
    const isPaired = pairedDevices.some(d => d.address === item.address) || item.bonded;
    const isConnected = connectedDevice && connectedDevice.address === item.address;

    return (
      <View style={[styles.deviceItem, isConnected && styles.connectedDeviceItem]}>
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{item.name || "Unknown Device"}</Text>
          <Text style={styles.deviceAddress}>{item.address}</Text>
          {isPaired && <Text style={styles.pairedLabel}>Paired</Text>}
          {isConnected && <Text style={styles.connectedLabel}>Connected</Text>}
        </View>
        <View style={styles.deviceActions}>
          {!isPaired && !isConnected && (
            <TouchableOpacity
              style={[styles.actionButton, styles.pairButton]}
              onPress={() => pairDevice(item)}
            >
              <Text style={styles.actionButtonText}>Pair</Text>
            </TouchableOpacity>
          )}
          {isConnected ? (
            <TouchableOpacity
              style={[styles.actionButton, styles.disconnectButton]}
              onPress={disconnect}
            >
              <Text style={styles.actionButtonText}>Disconnect</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.actionButton, styles.connectButton]}
              onPress={() => connectToDevice(item)}
            >
              <Text style={styles.actionButtonText}>Connect</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const sections = [
    { title: "Paired Devices", data: pairedDevices },
    { title: "Available Devices", data: scannedDevices.filter(d => !pairedDevices.find(pd => pd.address === d.address)) }
  ];

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Text style={styles.title}>Bluetooth Manager</Text>
        <TouchableOpacity onPress={fetchPairedDevices}>
          <Text style={styles.refreshText}>↻</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.controls}>
        <View style={styles.scanControls}>
          <TouchableOpacity
            style={[styles.button, scanning ? styles.stopButton : styles.scanButton]}
            onPress={scanning ? stopScan : startScan}
          >
            <Text style={styles.buttonText}>{scanning ? "Stop Scan" : "Scan New Devices"}</Text>
          </TouchableOpacity>
          {scanning && <ActivityIndicator size="small" color="#007bff" />}
        </View>
      </View>

      <SectionList
        sections={sections}
        renderItem={renderItem}
        renderSectionHeader={({ section: { title, data } }) => (
          data.length > 0 ? <Text style={styles.sectionHeader}>{title}</Text> : null
        )}
        keyExtractor={item => item.address}
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>{scanning ? "Scanning..." : "No new devices found. Start scan."}</Text>
        }
      />

      {connectedDevice && (
        <View style={styles.communicationContainer}>
          <Text style={styles.subtitle}>Send Data to {connectedDevice.name}</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Type message..."
              value={message}
              onChangeText={setMessage}
            />
            <TouchableOpacity style={[styles.button, styles.sendButton, { marginTop: 0, marginLeft: 10 }]} onPress={sendData}>
              <Text style={styles.buttonText}>Send</Text>
            </TouchableOpacity>
          </View>


          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.printButton]}
              onPress={async () => {
                try {
                  const result = await BluetoothModule.printTestReceipt();
                  Alert.alert("Success", result);
                } catch (e) {
                  Alert.alert("Print Error", e.message);
                }
              }}
            >
              <Text style={styles.buttonText}>Test Receipt</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.invoiceButton]}
              onPress={async () => {
                try {
                  const result = await BluetoothModule.printInvoice();
                  Alert.alert("Success", result);
                } catch (e) {
                  Alert.alert("Print Error", e.message);
                }
              }}
            >
              <Text style={styles.buttonText}>Print Invoice</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.kotButton]}
              onPress={async () => {
                try {
                  const result = await BluetoothModule.printKOT();
                  Alert.alert("Success", result);
                } catch (e) {
                  Alert.alert("Print Error", e.message);
                }
              }}
            >
              <Text style={styles.buttonText}>Print KOT</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.subtitle, { marginTop: 20 }]}>Logs</Text>
          <FlatList
            data={logs}
            renderItem={({ item }) => <Text style={styles.logText}>{item}</Text>}
            keyExtractor={(item, index) => index.toString()}
            style={styles.logsList}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingTop: Platform.OS === 'android' ? 30 : 0,
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  refreshText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007bff',
  },
  controls: {
    padding: 15,
  },
  scanControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButton: {
    backgroundColor: '#007bff',
  },
  stopButton: {
    backgroundColor: '#dc3545',
  },
  disconnectButton: {
    backgroundColor: '#6c757d',
    marginTop: 10,
  },
  sendButton: {
    backgroundColor: '#28a745',
    marginTop: 10,
  },
  printButton: {
    backgroundColor: '#6610f2',
    flex: 1,
  },
  invoiceButton: {
    backgroundColor: '#fd7e14',
    flex: 1,
  },
  kotButton: {
    backgroundColor: '#e83e8c',
    flex: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 15,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  list: {
    flex: 1,
    paddingHorizontal: 15,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: 'bold',
    backgroundColor: '#e9ecef',
    padding: 8,
    color: '#495057',
    marginTop: 10,
    borderRadius: 4,
  },
  deviceItem: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eee',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  deviceAddress: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  pairedLabel: {
    fontSize: 10,
    color: '#28a745',
    fontWeight: 'bold',
    marginTop: 2,
  },
  connectedLabel: {
    fontSize: 10,
    color: '#007bff',
    fontWeight: 'bold',
    marginTop: 2,
  },
  connectedDeviceItem: {
    borderColor: '#007bff',
    backgroundColor: '#e3f2fd',
  },
  deviceActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  pairButton: {
    backgroundColor: '#ffc107',
  },
  connectButton: {
    backgroundColor: '#17a2b8',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 20,
  },
  communicationContainer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#ccc',
    backgroundColor: '#fff',
    height: '40%',
  },
  subtitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  logsList: {
    flex: 1,
    marginTop: 10,
  },
  logText: {
    fontSize: 14,
    color: '#555',
    marginBottom: 4,
  },
});
