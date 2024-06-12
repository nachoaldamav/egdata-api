export const countries = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AN',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'XK',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW',
];

export const regions: Record<string, any> = {
  AE: {
    currencyCode: 'AED',
    description: 'United Arab Emirates',
    countries: ['AE'],
  },
  AFRICA: {
    currencyCode: 'USD',
    description: 'Africa pricing region',
    countries: [
      'LR',
      'TZ',
      'DJ',
      'LS',
      'YE',
      'UG',
      'MA',
      'DZ',
      'MG',
      'ML',
      'EH',
      'MR',
      'MU',
      'MW',
      'MZ',
      'ER',
      'AO',
      'ET',
      'NA',
      'ZM',
      'NE',
      'NG',
      'ZW',
      'BF',
      'RW',
      'BI',
      'BJ',
      'SC',
      'SD',
      'BW',
      'SL',
      'KE',
      'GA',
      'SN',
      'SO',
      'SS',
      'CD',
      'ST',
      'GH',
      'KM',
      'CF',
      'CG',
      'CI',
      'GM',
      'SZ',
      'GN',
      'GQ',
      'CM',
      'GW',
      'TD',
      'TG',
      'CV',
      'TN',
    ],
  },
  ANZ: {
    currencyCode: 'USD',
    description: 'Oceania pricing region',
    countries: [
      'CC',
      'TV',
      'MP',
      'NR',
      'FJ',
      'HM',
      'FM',
      'NU',
      'PW',
      'CK',
      'GU',
      'SB',
      'WF',
      'CX',
      'PG',
      'TK',
      'NF',
      'MH',
      'TO',
      'WS',
      'KI',
      'PN',
      'VU',
    ],
  },
  AR: {
    currencyCode: 'USD',
    description: 'Argentina',
    countries: ['AR'],
  },
  AU: {
    currencyCode: 'AUD',
    description: 'Australia',
    countries: ['AU'],
  },
  BG: {
    currencyCode: 'BGN',
    description: 'Bulgaria',
    countries: ['BG'],
  },
  BR2: {
    currencyCode: 'BRL',
    description: 'Brazil',
    countries: ['BR'],
  },
  CA: {
    currencyCode: 'CAD',
    description: 'Canada',
    countries: ['CA'],
  },
  CH: {
    currencyCode: 'CHF',
    description: 'Switzerland',
    countries: ['CH', 'LI'],
  },
  CIS: {
    currencyCode: 'USD',
    description: 'CIS pricing region',
    countries: ['UZ', 'TJ', 'MD', 'TM', 'AZ', 'KG', 'AM', 'GE'],
  },
  CL2: {
    currencyCode: 'CLP',
    description: 'Chile',
    countries: ['CL'],
  },
  CN2: {
    currencyCode: 'CNY',
    description: 'China',
    countries: ['CN'],
  },
  CO2: {
    currencyCode: 'COP',
    description: 'Colombia',
    countries: ['CO'],
  },
  CR2: {
    currencyCode: 'CRC',
    description: 'Costa Rica',
    countries: ['CR'],
  },
  CZ: {
    currencyCode: 'CZK',
    description: 'Czechia',
    countries: ['CZ'],
  },
  DK: {
    currencyCode: 'DKK',
    description: 'Denmark',
    countries: ['DK'],
  },
  EAST: {
    currencyCode: 'USD',
    description: 'Middle East/Central Asia pricing region',
    countries: [
      'MN',
      'EG',
      'PS',
      'JO',
      'AF',
      'SY',
      'IQ',
      'IR',
      'MV',
      'LY',
      'LB',
      'PK',
      'OM',
      'LK',
    ],
  },
  EURO: {
    currencyCode: 'EUR',
    description: 'Europe pricing region',
    countries: [
      'DE',
      'BE',
      'FI',
      'PT',
      'LT',
      'FO',
      'LU',
      'HR',
      'LV',
      'FR',
      'MC',
      'SI',
      'ME',
      'SK',
      'SM',
      'IE',
      'MK',
      'EE',
      'AD',
      'GL',
      'MT',
      'IS',
      'AL',
      'GR',
      'IT',
      'VA',
      'ES',
      'AT',
      'RE',
      'XK',
      'CY',
      'NL',
      'BA',
    ],
  },
  GB: {
    currencyCode: 'GBP',
    description: 'United Kingdom',
    countries: ['GB', 'GG', 'GI', 'IM', 'JE'],
  },
  HK2: {
    currencyCode: 'HKD',
    description: 'Hong Kong',
    countries: ['HK'],
  },
  HU: {
    currencyCode: 'HUF',
    description: 'Hungary',
    countries: ['HU'],
  },
  ID2: {
    currencyCode: 'IDR',
    description: 'Indonesia',
    countries: ['ID'],
  },
  IL: {
    currencyCode: 'ILS',
    description: 'Israel',
    countries: ['IL'],
  },
  IN2: {
    currencyCode: 'INR',
    description: 'India',
    countries: ['IN'],
  },
  JP: {
    currencyCode: 'JPY',
    description: 'Japan',
    countries: ['JP'],
  },
  KR2: {
    currencyCode: 'KRW',
    description: 'South Korea',
    countries: ['KR'],
  },
  KZ: {
    currencyCode: 'KZT',
    description: 'Kazakhstan',
    countries: ['KZ'],
  },
  LATAM: {
    currencyCode: 'USD',
    description: 'Latin America/Caribbean pricing region',
    countries: [
      'TT',
      'BB',
      'PR',
      'JM',
      'FK',
      'HN',
      'PY',
      'DM',
      'DO',
      'BM',
      'HT',
      'BO',
      'BS',
      'SH',
      'BZ',
      'GD',
      'EC',
      'SR',
      'KN',
      'SV',
      'MS',
      'AG',
      'AI',
      'GT',
      'VC',
      'AN',
      'TC',
      'VE',
      'PA',
      'GY',
      'CU',
      'AW',
      'LC',
      'NI',
    ],
  },
  MIDEAST: {
    currencyCode: 'USD',
    description: 'Bahrain/Kuwait pricing region',
    countries: ['BH', 'KW'],
  },
  MX2: {
    currencyCode: 'MXN',
    description: 'Mexico',
    countries: ['MX'],
  },
  MY2: {
    currencyCode: 'MYR',
    description: 'Malaysia',
    countries: ['MY'],
  },
  NO: {
    currencyCode: 'NOK',
    description: 'Norway',
    countries: ['NO'],
  },
  NZ: {
    currencyCode: 'NZD',
    description: 'New Zealand',
    countries: ['NZ'],
  },
  PE2: {
    currencyCode: 'PEN',
    description: 'Peru',
    countries: ['PE'],
  },
  PH2: {
    currencyCode: 'PHP',
    description: 'Philippines',
    countries: ['PH'],
  },
  PL: {
    currencyCode: 'PLN',
    description: 'Poland',
    countries: ['PL'],
  },
  QA: {
    currencyCode: 'QAR',
    description: 'Qatar',
    countries: ['QA'],
  },
  RO: {
    currencyCode: 'RON',
    description: 'Romania',
    countries: ['RO'],
  },
  ROW: {
    currencyCode: 'USD',
    description: 'Rest of World pricing region',
    countries: [
      'RS',
      'BL',
      'BQ',
      'BV',
      'SJ',
      'UM',
      'MF',
      'YT',
      'GF',
      'MQ',
      'KP',
      'SX',
      'IO',
      'GP',
      'GS',
      'KY',
      'AQ',
      'VG',
      'AS',
      'TF',
      'VI',
      'CW',
      'NC',
      'PF',
      'AX',
      'PM',
    ],
  },
  RU: {
    currencyCode: 'RUB',
    description: 'Russia',
    countries: ['RU', 'BY'],
  },
  SA: {
    currencyCode: 'SAR',
    description: 'Saudi Arabia',
    countries: ['SA'],
  },
  SE: {
    currencyCode: 'SEK',
    description: 'Sweden',
    countries: ['SE'],
  },
  SEA: {
    currencyCode: 'USD',
    description: 'Southeast Asia pricing region',
    countries: ['MM', 'MO', 'NP', 'BD', 'BT', 'LA', 'TL', 'BN', 'KH'],
  },
  SG2: {
    currencyCode: 'SGD',
    description: 'Singapore',
    countries: ['SG'],
  },
  TH2: {
    currencyCode: 'THB',
    description: 'Thailand',
    countries: ['TH'],
  },
  TR: {
    currencyCode: 'TRY',
    description: 'Turkey',
    countries: ['TR'],
  },
  TW2: {
    currencyCode: 'TWD',
    description: 'Taiwan',
    countries: ['TW'],
  },
  UA: {
    currencyCode: 'UAH',
    description: 'Ukraine',
    countries: ['UA'],
  },
  US: {
    currencyCode: 'USD',
    description: 'United States',
    countries: ['US'],
  },
  UY2: {
    currencyCode: 'UYU',
    description: 'Uruguay',
    countries: ['UY'],
  },
  VN2: {
    currencyCode: 'VND',
    description: 'Vietnam',
    countries: ['VN'],
  },
  ZA2: {
    currencyCode: 'ZAR',
    description: 'South Africa',
    countries: ['ZA'],
  },
};
