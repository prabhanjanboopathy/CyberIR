import { useEffect, useState } from 'react'
import { Alert, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

type Incident = {
  id: string
  number: string
  title: string
  status: string
  severity: string
  category: string
}

const DEFAULT_API_URL = 'http://localhost:4000/api/v1'

export default function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_URL)
  const [email, setEmail] = useState('manager@northstar.test')
  const [password, setPassword] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [pushToken, setPushToken] = useState<string | null>(null)
  const [status, setStatus] = useState('Ready to connect to the API.')

  useEffect(() => {
    void loadIncidents()
  }, [accessToken, apiBaseUrl])

  async function loadIncidents() {
    if (!accessToken) {
      setIncidents([])
      return
    }

    try {
      const response = await fetch(`${apiBaseUrl}/incidents?limit=5`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) {
        throw new Error(`API request failed with ${response.status}`)
      }
      const body = await response.json() as { data?: Incident[] }
      setIncidents(body.data ?? [])
      setStatus('Incident feed synced.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load incidents')
    }
  }

  async function login() {
    try {
      setStatus('Signing in to the API…')
      const response = await fetch(`${apiBaseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = await response.json() as { data?: { accessToken?: string }; error?: { message?: string } }
      if (!response.ok || !body.data?.accessToken) {
        throw new Error(body.error?.message ?? 'Login failed')
      }
      setAccessToken(body.data.accessToken)
      setStatus('Authenticated successfully.')
    } catch (error) {
      Alert.alert('Login failed', error instanceof Error ? error.message : 'Could not log in')
      setStatus('Authentication failed.')
    }
  }

  async function registerPushToken() {
    if (!accessToken) {
      Alert.alert('Not logged in', 'Sign in before registering a device token.')
      return
    }

    if (!Device.isDevice) {
      setStatus('Push registration requires a physical device or simulator support.')
      return
    }

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync()
      let finalStatus = existingStatus
      if (finalStatus !== 'granted') {
        const permission = await Notifications.requestPermissionsAsync()
        finalStatus = permission.status
      }
      if (finalStatus !== 'granted') {
        throw new Error('Notification permission was denied.')
      }

      const expoPushToken = await Notifications.getExpoPushTokenAsync()
      const nextToken = expoPushToken.data
      setPushToken(nextToken)

      const response = await fetch(`${apiBaseUrl}/mobile/push-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ pushToken: nextToken, enabled: true }),
      })
      const body = await response.json() as { error?: { message?: string } }
      if (!response.ok) {
        throw new Error(body.error?.message ?? 'Could not register push token')
      }
      setStatus('Mobile push token registered.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to register push token')
      Alert.alert('Push registration', error instanceof Error ? error.message : 'Unable to register push token')
    }
  }

  async function sendTestPush() {
    if (!accessToken) {
      Alert.alert('Not logged in', 'Sign in before sending a test push notification.')
      return
    }

    try {
      const response = await fetch(`${apiBaseUrl}/mobile/send-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      })
      const body = await response.json() as { error?: { message?: string } }
      if (!response.ok) {
        throw new Error(body.error?.message ?? 'Unable to trigger a push notification')
      }
      setStatus('Test notification delivered to the registered device.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Push delivery failed')
      Alert.alert('Test push', error instanceof Error ? error.message : 'Push delivery failed')
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Sentinel Ops</Text>
          <Text style={styles.title}>Mobile incident response</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>API base URL</Text>
          <TextInput value={apiBaseUrl} onChangeText={setApiBaseUrl} style={styles.input} autoCapitalize="none" autoCorrect={false} />

          <Text style={styles.label}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />

          <Text style={styles.label}>Password</Text>
          <TextInput value={password} onChangeText={setPassword} style={styles.input} secureTextEntry />

          <View style={styles.row}>
            <Pressable style={styles.primaryButton} onPress={login}>
              <Text style={styles.primaryButtonText}>Sign in</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={registerPushToken}>
              <Text style={styles.secondaryButtonText}>Register device</Text>
            </Pressable>
          </View>

          <Pressable style={styles.primaryButton} onPress={sendTestPush}>
            <Text style={styles.primaryButtonText}>Send test push</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connection status</Text>
          <Text style={styles.status}>{status}</Text>
          {pushToken ? <Text style={styles.meta}>Expo token: {pushToken}</Text> : <Text style={styles.meta}>No push token registered yet.</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Open incidents</Text>
          {incidents.length === 0 ? (
            <Text style={styles.meta}>Sign in to load the incident feed.</Text>
          ) : (
            incidents.map((incident) => (
              <View key={incident.id} style={styles.incidentRow}>
                <View style={styles.incidentHeader}>
                  <Text style={styles.incidentNumber}>{incident.number}</Text>
                  <Text style={styles.severityBadge}>{incident.severity}</Text>
                </View>
                <Text style={styles.incidentTitle}>{incident.title}</Text>
                <Text style={styles.meta}>{incident.category} · {incident.status}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#eef3f8',
  },
  content: {
    padding: 20,
    gap: 16,
  },
  header: {
    gap: 4,
  },
  kicker: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#1d4ed8',
    fontWeight: '700',
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#0f172a',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    gap: 10,
  },
  label: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#dbe2ec',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
    color: '#0f172a',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  cardTitle: {
    fontWeight: '700',
    color: '#0f172a',
    fontSize: 16,
  },
  status: {
    color: '#0f172a',
    fontSize: 14,
    lineHeight: 20,
  },
  meta: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 18,
  },
  incidentRow: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 12,
    gap: 6,
  },
  incidentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  incidentNumber: {
    fontWeight: '700',
    color: '#1e293b',
  },
  severityBadge: {
    backgroundColor: '#fee2e2',
    color: '#b91c1c',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '700',
  },
  incidentTitle: {
    color: '#0f172a',
    fontWeight: '600',
  },
})
