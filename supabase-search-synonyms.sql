-- Search Synonyms: Run this in Supabase SQL Editor
-- ================================================

-- 1. Create the search_synonyms table
CREATE TABLE search_synonyms (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  keywords text[] NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE search_synonyms ENABLE ROW LEVEL SECURITY;

-- 2. Seed with Sri Lankan auto parts market synonyms

-- Body Parts
INSERT INTO search_synonyms (keywords) VALUES
  (ARRAY['bumper', 'buffer', 'bumber', 'front buffer', 'rear buffer']),
  (ARRAY['bonnet', 'hood', 'bonet', 'engine hood']),
  (ARRAY['boot', 'trunk', 'dicky', 'boot lid', 'trunk lid']),
  (ARRAY['fender', 'mudguard', 'quarter panel', 'fender panel']),
  (ARRAY['door panel', 'door trim', 'door card', 'door lining']),
  (ARRAY['windshield', 'windscreen', 'front glass', 'wind screen']),
  (ARRAY['side mirror', 'wing mirror', 'door mirror', 'side glass mirror']),
  (ARRAY['radiator grill', 'front grill', 'grille', 'grill']),

-- Lights
  (ARRAY['headlight', 'head light', 'headlamp', 'head lamp', 'front light']),
  (ARRAY['taillight', 'tail light', 'tail lamp', 'rear light', 'back light']),
  (ARRAY['indicator', 'signal light', 'blinker', 'turn signal', 'indicator light']),
  (ARRAY['fog light', 'fog lamp', 'fog']),
  (ARRAY['brake light', 'stop light', 'stop lamp']),

-- Engine
  (ARRAY['timing belt', 'cam belt', 'cambelt']),
  (ARRAY['spark plug', 'ignition plug', 'plug']),
  (ARRAY['air filter', 'air cleaner', 'air element']),
  (ARRAY['oil filter', 'oil element', 'oil cleaner']),
  (ARRAY['radiator', 'radaitor', 'radiater', 'coolant radiator']),
  (ARRAY['alternator', 'alternater', 'charging motor']),
  (ARRAY['compressor', 'compresser', 'ac compressor', 'a/c compressor']),
  (ARRAY['starter motor', 'starter', 'self motor', 'self starter']),
  (ARRAY['water pump', 'waterpump', 'coolant pump']),
  (ARRAY['fan belt', 'drive belt', 'v belt', 'v-belt']),

-- Brake
  (ARRAY['brake pad', 'brake pads', 'brake shoe', 'front pad', 'rear pad']),
  (ARRAY['disc rotor', 'brake disc', 'brake rotor', 'disk rotor']),
  (ARRAY['brake caliper', 'brake calliper', 'caliper', 'calliper']),

-- Suspension & Steering
  (ARRAY['shock absorber', 'shock', 'damper', 'absorber', 'shocks']),
  (ARRAY['ball joint', 'lower arm ball', 'upper ball joint', 'lower ball joint']),
  (ARRAY['tie rod', 'tie rod end', 'rack end', 'tierod']),
  (ARRAY['cv joint', 'drive shaft joint', 'cv boot']),
  (ARRAY['wheel bearing', 'hub bearing', 'front bearing', 'rear bearing']),
  (ARRAY['stabilizer link', 'sway bar link', 'anti roll bar link', 'stab link']),
  (ARRAY['control arm', 'lower arm', 'upper arm', 'suspension arm']),

-- Exhaust
  (ARRAY['exhaust', 'exaust', 'exhaust pipe', 'muffler', 'silencer']),
  (ARRAY['catalytic converter', 'cat converter', 'catalytic']),

-- Transmission
  (ARRAY['clutch plate', 'clutch disc', 'clutch disk', 'clutch']),
  (ARRAY['gearbox', 'gear box', 'transmission']),
  (ARRAY['axle', 'drive shaft', 'half shaft', 'axel']),

-- A/C & Cooling
  (ARRAY['condenser', 'ac condenser', 'a/c condenser']),
  (ARRAY['evaporator', 'ac evaporator', 'cooling coil']),
  (ARRAY['thermostat', 'termostat', 'coolant thermostat']),
  (ARRAY['cabin filter', 'ac filter', 'pollen filter', 'cabin air filter']),

-- Wipers & Others
  (ARRAY['wiper blade', 'wiper rubber', 'wiper', 'windshield wiper']),
  (ARRAY['battery', 'car battery', 'accumulator']),
  (ARRAY['fuel pump', 'petrol pump', 'diesel pump', 'fuel motor']),
  (ARRAY['power steering pump', 'ps pump', 'power steering']),
  (ARRAY['ignition coil', 'coil pack', 'spark coil', 'ignition']);
