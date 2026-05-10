// Player name pools by nationality (rough — first names + surnames).
// Used by seed to give 720 players plausible names without listing real-life players.

export const ENGLISH_FIRST = [
  'James', 'Jack', 'Harry', 'Tom', 'Joe', 'Sam', 'Ben', 'Will', 'George', 'Charlie',
  'Daniel', 'Oliver', 'Marcus', 'Jordan', 'Reece', 'Phil', 'Mason', 'Conor', 'Kyle',
  'Ross', 'Ethan', 'Tyler', 'Lewis', 'Ryan', 'Aaron', 'Curtis', 'Trent', 'Bukayo',
  'Eddie', 'Dean', 'Kalvin', 'Declan', 'Marc', 'Alex', 'Jude', 'Cole',
];

export const ENGLISH_LAST = [
  'Smith', 'Jones', 'Williams', 'Brown', 'Taylor', 'Davies', 'Wilson', 'Evans',
  'Thomas', 'Roberts', 'Walker', 'Wright', 'Robinson', 'Thompson', 'White', 'Harris',
  'Lewis', 'Clarke', 'Hughes', 'Edwards', 'Cook', 'Allen', 'Bell', 'Hall', 'Cooper',
  'Murphy', 'Bailey', 'Foster', 'Carter', 'Russell', 'Bennett', 'Saunders', 'Holland',
  'Mitchell', 'Hayes', 'Phillips',
];

export const SPANISH_FIRST = [
  'Alejandro', 'Daniel', 'Pablo', 'Diego', 'Manuel', 'Javier', 'Sergio', 'Adrian',
  'Carlos', 'David', 'Iván', 'Alvaro', 'Jose', 'Luis', 'Antonio', 'Miguel',
  'Raúl', 'Marco', 'Pedro', 'Joan', 'Iker', 'Rodri', 'Saul', 'Marcos',
  'Fernando', 'Roberto', 'Cesar', 'Lucas', 'Hugo', 'Mario', 'Bruno', 'Aitor',
  'Asier', 'Xabi', 'Mikel', 'Gerard',
];

export const SPANISH_LAST = [
  'García', 'Rodríguez', 'Martínez', 'González', 'López', 'Hernández', 'Pérez',
  'Sánchez', 'Ramírez', 'Torres', 'Flores', 'Rivera', 'Gómez', 'Díaz', 'Ortiz',
  'Vargas', 'Castillo', 'Romero', 'Morales', 'Reyes', 'Fernández', 'Suárez',
  'Iglesias', 'Vega', 'Castro', 'Aguilar', 'Mendoza', 'Soto', 'Núñez', 'Cabrera',
  'Salazar', 'Peña', 'Cortés', 'Delgado', 'Jiménez', 'Molina',
];

// Some cosmopolitan extras for both leagues — mirrors modern squads.
export const FOREIGN_FIRST = [
  'Mohamed', 'Yassine', 'Cheick', 'Ousmane', 'Bamba', 'Souleymane',
  'Lukas', 'Florian', 'Niklas', 'Mats', 'Stefan', 'Kai',
  'Marco', 'Andrea', 'Federico', 'Lorenzo', 'Riccardo',
  'João', 'Bruno', 'Gabriel', 'Vinicius', 'Rodrygo', 'Bernardo',
  'Tomáš', 'Adam', 'Lukáš', 'Petr',
  'Anders', 'Erik', 'Magnus', 'Mikael',
];

export const FOREIGN_LAST = [
  'Diakité', 'Mensah', 'Konaté', 'Owusu', 'Salah',
  'Müller', 'Schmidt', 'Weber', 'Becker', 'Hoffmann',
  'Rossi', 'Bianchi', 'Romano', 'Conti', 'Esposito',
  'Silva', 'Costa', 'Ribeiro', 'Carvalho', 'Pereira',
  'Novák', 'Procházka', 'Horák',
  'Andersson', 'Bergström', 'Lindholm', 'Carlsson',
];

// Pick a random name from a pool given a seed (deterministic).
export function pickName(rng, leagueSlug) {
  // 70% local, 30% foreign for flavor.
  const useLocal = rng() < 0.70;
  const englishLeague = leagueSlug === 'epl';
  const firstPool = useLocal
    ? (englishLeague ? ENGLISH_FIRST : SPANISH_FIRST)
    : FOREIGN_FIRST;
  const lastPool = useLocal
    ? (englishLeague ? ENGLISH_LAST : SPANISH_LAST)
    : FOREIGN_LAST;
  const firstInitial = firstPool[Math.floor(rng() * firstPool.length)][0];
  const last = lastPool[Math.floor(rng() * lastPool.length)];
  return `${firstInitial}. ${last}`;
}
