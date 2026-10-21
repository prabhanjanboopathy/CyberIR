export const LEVELS = {
  0: 'Reporter',
  1: 'Cybersecurity Engineer',
  2: 'Risk Analyst',
  3: 'Admin',
}

export const ATTACK_TYPES = [
  'Malware',
  'Trojan Horse',
  'Ransomware',
  'Phishing',
  'DDoS',
  'Network Intrusion',
  'Insider Threat',
  'Data Breach',
  'Other',
]

export const SPECIALTIES = [
  'Malware',
  'Trojan Horse',
  'Phishing/Social Engineering',
  'Ransomware',
  'DDoS/Network Intrusion',
]

export const SPECIALTY_FOR_ATTACK = {
  Malware: 'Malware',
  'Trojan Horse': 'Trojan Horse',
  Ransomware: 'Ransomware',
  Phishing: 'Phishing/Social Engineering',
  DDoS: 'DDoS/Network Intrusion',
  'Network Intrusion': 'DDoS/Network Intrusion',
}

export const STATUSES = [
  'Yet to Assess',
  'Under Assessment',
  'Under Surveillance',
  'In Progress',
  'Completed',
  'Closed',
]

export const ENGINEER_STATUSES = ['Under Assessment', 'In Progress', 'Completed']
export const DONE_STATUSES = ['Completed', 'Closed']
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical']
export const AVAILABILITY = ['available', 'busy', 'offline']
export const DEFAULT_MAX_ACTIVE_CASES = 5
