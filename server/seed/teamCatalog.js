// Team catalog — 40 real-feeling fictional clubs across two leagues.
// City + identity pattern; trademark-safe but recognizable to friends.
// Tier 1 = elite (UCL contender); 5 = relegation candidate. Drives roster strength.

export const EPL_TEAMS = [
  { slug: 'manchester-reds',    name: 'Manchester Reds',    short: 'MNR', city: 'Manchester',  color: '#DA2127', tier: 1, founded: 1878 },
  { slug: 'manchester-blues',   name: 'Manchester Blues',   short: 'MNB', city: 'Manchester',  color: '#6CABDD', tier: 1, founded: 1894 },
  { slug: 'london-reds',        name: 'London Reds',        short: 'LDR', city: 'London',      color: '#EF0107', tier: 1, founded: 1886 },
  { slug: 'london-blues',       name: 'London Blues',       short: 'LDB', city: 'London',      color: '#034694', tier: 1, founded: 1905 },
  { slug: 'london-spurs',       name: 'London Spurs',       short: 'SPS', city: 'London',      color: '#132257', tier: 2, founded: 1882 },
  { slug: 'liverpool-reds',     name: 'Liverpool Reds',     short: 'LVR', city: 'Liverpool',   color: '#C8102E', tier: 1, founded: 1892 },
  { slug: 'liverpool-toffees',  name: 'Liverpool Toffees',  short: 'EVT', city: 'Liverpool',   color: '#003399', tier: 3, founded: 1878 },
  { slug: 'newcastle-magpies',  name: 'Newcastle Magpies',  short: 'NCM', city: 'Newcastle',   color: '#241F20', tier: 2, founded: 1892 },
  { slug: 'birmingham-villa',   name: 'Birmingham Villa',   short: 'BVL', city: 'Birmingham',  color: '#7A003C', tier: 2, founded: 1874 },
  { slug: 'birmingham-blues',   name: 'Birmingham Blues',   short: 'BMB', city: 'Birmingham',  color: '#0027A3', tier: 4, founded: 1875 },
  { slug: 'leicester-foxes',    name: 'Leicester Foxes',    short: 'LCF', city: 'Leicester',   color: '#003090', tier: 3, founded: 1884 },
  { slug: 'brighton-seagulls',  name: 'Brighton Seagulls',  short: 'BHS', city: 'Brighton',    color: '#0057B8', tier: 3, founded: 1901 },
  { slug: 'crystal-eagles',     name: 'Crystal Eagles',     short: 'CEG', city: 'London',      color: '#1B458F', tier: 4, founded: 1905 },
  { slug: 'westham-hammers',    name: 'West Ham Hammers',   short: 'WHM', city: 'London',      color: '#7A263A', tier: 3, founded: 1895 },
  { slug: 'wolverhampton-wolves', name: 'Wolverhampton Wolves', short: 'WVW', city: 'Wolverhampton', color: '#FDB913', tier: 4, founded: 1877 },
  { slug: 'fulham-cottagers',   name: 'Fulham Cottagers',   short: 'FUC', city: 'London',      color: '#FFFFFF', tier: 4, founded: 1879 },
  { slug: 'bournemouth-cherries', name: 'Bournemouth Cherries', short: 'BMC', city: 'Bournemouth', color: '#DA291C', tier: 4, founded: 1899 },
  { slug: 'brentford-bees',     name: 'Brentford Bees',     short: 'BTF', city: 'Brentford',   color: '#FFB81C', tier: 4, founded: 1889 },
  { slug: 'sheffield-blades',   name: 'Sheffield Blades',   short: 'SHU', city: 'Sheffield',   color: '#EE2737', tier: 5, founded: 1889 },
  { slug: 'nottingham-forest',  name: 'Nottingham Forest',  short: 'NFC', city: 'Nottingham',  color: '#DD0000', tier: 4, founded: 1865 },
];

export const LALIGA_TEAMS = [
  { slug: 'madrid-whites',      name: 'Madrid Whites',      short: 'MDW', city: 'Madrid',     color: '#FFFFFF', tier: 1, founded: 1902 },
  { slug: 'madrid-atletico',    name: 'Madrid Atletico',    short: 'MDA', city: 'Madrid',     color: '#CB3524', tier: 1, founded: 1903 },
  { slug: 'madrid-rayo',        name: 'Madrid Rayo',        short: 'RYM', city: 'Madrid',     color: '#FFFFFF', tier: 4, founded: 1924 },
  { slug: 'barcelona-blaugranas', name: 'Barcelona Blaugranas', short: 'BCB', city: 'Barcelona', color: '#A50044', tier: 1, founded: 1899 },
  { slug: 'barcelona-espanyol', name: 'Barcelona Espanyol', short: 'BCE', city: 'Barcelona',  color: '#003F88', tier: 4, founded: 1900 },
  { slug: 'sevilla-rojiblancos', name: 'Sevilla Rojiblancos', short: 'SVR', city: 'Sevilla',  color: '#D71920', tier: 2, founded: 1890 },
  { slug: 'sevilla-betis',      name: 'Sevilla Betis',      short: 'BET', city: 'Sevilla',    color: '#0BB363', tier: 3, founded: 1907 },
  { slug: 'valencia-bats',      name: 'Valencia Bats',      short: 'VLB', city: 'Valencia',   color: '#EE3524', tier: 3, founded: 1919 },
  { slug: 'bilbao-lions',       name: 'Bilbao Lions',       short: 'BLB', city: 'Bilbao',     color: '#EE2523', tier: 2, founded: 1898 },
  { slug: 'sansebastian-real',  name: 'San Sebastian Real', short: 'SSR', city: 'San Sebastián', color: '#0067B2', tier: 2, founded: 1909 },
  { slug: 'mallorca-real',      name: 'Mallorca Real',      short: 'MLR', city: 'Mallorca',   color: '#E20613', tier: 4, founded: 1916 },
  { slug: 'palmas-canarios',    name: 'Las Palmas Canarios', short: 'LPC', city: 'Las Palmas', color: '#FFE800', tier: 5, founded: 1949 },
  { slug: 'villarreal-submarines', name: 'Villarreal Submarines', short: 'VLS', city: 'Villarreal', color: '#FFE667', tier: 2, founded: 1923 },
  { slug: 'vigo-celestes',      name: 'Vigo Celestes',      short: 'CLT', city: 'Vigo',       color: '#7AC0E5', tier: 4, founded: 1923 },
  { slug: 'granada-nazaries',   name: 'Granada Nazaries',   short: 'GRN', city: 'Granada',    color: '#A50044', tier: 5, founded: 1931 },
  { slug: 'cadiz-amarillos',    name: 'Cadiz Amarillos',    short: 'CDZ', city: 'Cádiz',      color: '#FFD700', tier: 5, founded: 1910 },
  { slug: 'osasuna-rojillos',   name: 'Osasuna Rojillos',   short: 'OSR', city: 'Pamplona',   color: '#D40000', tier: 3, founded: 1920 },
  { slug: 'getafe-azulones',    name: 'Getafe Azulones',    short: 'GTF', city: 'Getafe',     color: '#003DA5', tier: 4, founded: 1983 },
  { slug: 'alaves-babazorros',  name: 'Alaves Babazorros',  short: 'ALV', city: 'Vitoria',    color: '#005BAC', tier: 4, founded: 1921 },
  { slug: 'girona-rojiblancos', name: 'Girona Rojiblancos', short: 'GIR', city: 'Girona',     color: '#FF0000', tier: 3, founded: 1930 },
];
