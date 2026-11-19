(function (global) {
  'use strict';

  // English texts of the planets and operations (js/data/operations.js), laid over the Japanese
  // ones when the page runs in English (?lang=en, js/i18n.js). Only the texts are here: keyed by
  // planet id and operation id, with the same shape as the data (sites / survey points by index).
  if (!global.I18n || !global.I18n.isEn) return;

  const pre = (stage, planet) =>
    `To every tank crew of the 1st Armored Platoon, entering the ${stage} stage of the assault on ${planet}`;

  const PLANETS_EN = {
    1: {
      name: 'Planet Zahar',
      terrain: 'Desert',
      summary: 'A desert planet of dunes, salt flats and scattered oasis cities, held by a frontier garrison far from the enemy homeland.',
      operations: {
        'zahar-1': {
          phase: 'Erosion',
          name: 'Wedge of Thirst',
          goal: 'Capture the water plant and two border outposts',
          summary: 'Cut the water supply to the enemy compounds and crush the border outposts under cover of the sandstorms.',
          sites: [{ name: 'Water Plant' }, { name: 'Outpost A' }, { name: 'Outpost B' }],
          scenario: {
            prehead: pre('first', 'Planet Zahar'),
            catch: 'In the desert, the strongest weapon is water.',
            deck: 'The frontier garrison has staked its life on a single water plant. Shutting off that tap is our first move.',
            lead: 'Seize the water plant and crush the border outposts. This planet\'s sandstorms steal all sight, but they blind the enemy too. '
              + 'Close in under the storm, and the outposts will not know you are there until they hear your guns. '
              + 'Operation "Wedge of Thirst" — this wedge puts the first crack in the enemy\'s defenses.'
          },
          mio: {
            tactical: 'Your targets are the water plant and the two border outposts. The order is up to you. '
              + 'Sandstorms roll in from time to time on this planet. Inside a storm the enemy can\'t spot us either, so use them to close in.',
            enemies: 'The enemy has old light and medium tanks, plus pillboxes. They\'re few in number, but the compounds are well defended.',
            terrain: 'Three things to watch out for. Run at full speed for too long and the engine overheats. '
              + 'The faster you go, the more dust you kick up, and distant compounds will spot you more easily. '
              + 'And the sandstorms: visibility drops to almost nothing, but the same goes for the enemy. Sortie when you\'re ready.'
          },
          radio: {
            start: [
              'This is HQ, Mio speaking. Operation "Wedge of Thirst" is underway. Targets: the water plant and two outposts.',
              'Run flat out for too long and the engine will overheat. Watch your dust too, Commander.'
            ],
            complete: [
              'Water plant and border outposts all confirmed captured. We\'ve driven a wedge into their supply line.',
              'Please return to HQ, Commander.'
            ]
          }
        },
        'zahar-2': {
          phase: 'Decisive Battle',
          name: 'Guns of the Salt Flats',
          goal: 'Destroy the two artillery positions on the salt flats and the commander\'s heavy tank platoon',
          summary: 'On the open salt flats, trade long-range fire with the garrison\'s main force.',
          bossName: '⚠ Garrison Commander\'s Tank',
          sites: [{ name: 'West Artillery' }, { name: 'East Artillery' }, { name: 'Commander\'s Unit' }],
          scenario: {
            prehead: pre('second', 'Planet Zahar'),
            catch: 'There is nowhere to hide. So whoever hits first, wins.',
            deck: 'Cut off from water, the garrison has massed its main force on the salt flats. Their commander is leading the heavy tanks in person, coming to settle this.',
            lead: 'There is not a single rock on the flats. Range, and the judgment of the moment you fire, are everything. '
              + 'By day, mirages rise over the flats: distant enemies waver, and shots go wide. Don\'t rush; close the distance. '
              + 'Operation "Guns of the Salt Flats" — let these guns change the air on Zahar.'
          },
          mio: {
            tactical: 'Your targets are the two artillery positions on the salt flats and the commander\'s heavy tank platoon. '
              + 'The flats stretch north of HQ. Your aiming range is extended for this operation, but the enemy\'s reach is longer too.',
            enemies: 'Heavy and medium tanks, pillboxes, and the large command tank carrying their commander. Its armor and firepower are on another level.',
            terrain: 'There is no cover at all on the salt flats. In daytime, mirages make distant enemies appear to shift. '
              + 'Far targets are hard to hit, so get reasonably close before you fire.'
          },
          radio: {
            start: [
              'Mio here. Starting Operation "Guns of the Salt Flats". Targets: two artillery positions and the commander\'s unit on the salt flats to the north.',
              'Mirages form over the flats. A distant enemy may not be where it appears.'
            ],
            complete: [
              'Commander\'s unit confirmed destroyed... the garrison\'s main force is finished! We did it, Commander.',
              'Please return to HQ.'
            ]
          }
        },
        'zahar-3': {
          phase: 'Decapitation',
          name: 'Throne of Sand',
          goal: 'Capture the governor\'s palace in the oasis city and seal off the area until the infantry are in',
          summary: 'Fight through the maze of the old town, take the governor\'s palace, and cover the infantry\'s assault.',
          sites: [{ name: 'West Gate Guard' }, { name: 'Governor\'s Palace' }],
          hold: { label: 'Seal off the palace', banner: 'Holding — until the assault is done' },
          scenario: {
            prehead: pre('final', 'Planet Zahar'),
            catch: 'Only those who make it through the narrow alleys reach the throne.',
            deck: 'Its main force gone, the garrison has holed up in the governor\'s palace of the oasis city. Take it, and the fight for Zahar is over.',
            lead: 'The alleys of the old town are narrow; turn a corner and the enemy is right in front of you. The long-range instincts you honed on the flats won\'t serve you here. '
              + 'Once the palace is taken, seal off the area until the infantry have gone in. Enemy reinforcements will come. '
              + 'Operation "Throne of Sand" — drag the enemy down from that throne.'
          },
          mio: {
            tactical: 'Your target is the governor\'s palace in the oasis city, east of HQ. A garrison guards the west gate on the way. '
              + 'Once the palace is captured, seal off the area around it for 60 seconds until the infantry finish their assault.',
            enemies: 'The palace garrison, and the reinforcements that rush in while you hold. There are heavy tanks too. Watch for sudden encounters at alley corners.',
            terrain: 'The old town is packed with buildings, and buildings stop shells. The streets are narrow, with dead ends. '
              + 'The east-west and north-south avenues run straight to the palace. If you get lost, use the avenues.'
          },
          radio: {
            start: [
              'Mio here. Starting Operation "Throne of Sand". Target: the governor\'s palace in the oasis city to the east.',
              'The old town is nothing but narrow alleys. Watch out at the corners.'
            ],
            holdStart: [
              'Palace captured! The infantry are starting their assault.',
              'Stay inside the circle around the palace for 60 seconds until they\'re done. Enemy reinforcements are coming!'
            ],
            complete: [
              'The infantry have secured the palace! The garrison of Planet Zahar has surrendered.',
              'Good work, Commander. Please return to HQ.'
            ]
          }
        }
      }
    },
    2: {
      name: 'Planet Verg',
      terrain: 'Ice',
      summary: 'An ice planet shut in by blizzards, frozen lakes and mountains. Elite troops in a mountain fortress hold the pass; the capital lies beyond the lake.',
      operations: {
        'verg-1': {
          phase: 'Erosion',
          name: 'The White Detour',
          goal: 'Feint at the pass, survey the lake ice, capture the lakeshore outpost',
          summary: 'Draw the enemy\'s main force with a fake attack on the pass, and meanwhile scout a route across the frozen lake.',
          sites: [{ name: 'Pass Fortress' }, { name: 'Lakeshore Outpost' }],
          survey: [{ name: 'Survey Point A' }, { name: 'Survey Point B' }, { name: 'Survey Point C' }],
          scenario: {
            prehead: pre('first', 'Planet Verg'),
            catch: 'If you can\'t go through the front, take the frozen road.',
            deck: 'A map seized at Zahar\'s governor\'s palace showed a way around: not over the mountain pass, but across the frozen lake.',
            lead: 'The pass fortress is held by this planet\'s elite troops. Meet them head-on and the platoon won\'t last a minute. '
              + 'So feint an attack to pin them at the pass, and test the lake ice while they look the other way. '
              + 'Operation "The White Detour" — while the enemy watches the pass, we cross the lake.'
          },
          mio: {
            tactical: 'There are three objectives. Show yourself at the pass fortress to the northwest, get the enemy to bite, and pull them away. '
              + 'Check the ice at three survey points on the frozen lake to the northeast. And capture the lakeshore outpost. You don\'t need to take the pass fortress.',
            enemies: 'These are the planet\'s elite troops. Heavy tanks wait in the pass fortress. Don\'t get into a straight firefight.',
            terrain: 'On this planet, stand still for long and your tank chills: the turret turns slowly and the engine goes sluggish. '
              + 'Don\'t stop on the frozen lake, or the ice will crack. Darker patches are thin ice, and heavy tanks break right through. '
              + 'When the blizzard cuts visibility, the heat sensor shows the enemy. Sortie when you\'re ready.'
          },
          radio: {
            start: [
              'Mio here. Starting Operation "The White Detour". First, show yourself at the pass fortress and get the enemy to bite.',
              'Don\'t stop on the lake. The ice will crack.'
            ],
            complete: [
              'Feint, survey and outpost capture all complete. The route across the lake is open.',
              'Please return to HQ, Commander.'
            ]
          }
        },
        'verg-2': {
          phase: 'Decapitation',
          name: 'Polar Night Strike',
          goal: 'Cross the frozen lake and capture the headquarters in the capital',
          summary: 'Under the sunless dark of the polar night, cross the lake and storm the capital at the foot of the mountains.',
          sites: [{ name: 'Gate Guard' }, { name: 'Headquarters' }],
          scenario: {
            prehead: pre('second', 'Planet Verg'),
            catch: 'If the night will not end, seize it, darkness and all.',
            deck: 'The polar night has come. On this planet the sun will not rise for a long time. The enemy\'s eyes are sealed by the dark.',
            lead: 'Cross the lake and storm the capital at the foot of the mountains. There is one objective: the enemy headquarters. '
              + 'In the dark, the enemy won\'t notice you until you open fire. Until the first shot, approach in silence. '
              + 'Operation "Polar Night Strike" — we settle this without waiting for dawn.'
          },
          mio: {
            tactical: 'Your target is the headquarters in the capital. The capital lies northeast of the frozen lake; from HQ, crossing the lake is the shortest way. A gate guard stands in front of it. '
              + 'During the polar night the clock doesn\'t move. It stays night the whole time.',
            enemies: 'The capital garrison and the headquarters guard. In the dark, the enemy won\'t notice us until fired on. Strike first.',
            terrain: 'Don\'t stop on the frozen lake, and avoid the dark, thin ice. '
              + 'In the dark, the heat sensor shows the enemy. Inside the capital, buildings stand close together, and buildings stop shells.'
          },
          radio: {
            start: [
              'Mio here. Starting Operation "Polar Night Strike". Target: the headquarters in the capital.',
              'The enemy hasn\'t noticed us in the dark. Approach quietly until the first shot.'
            ],
            complete: [
              'Headquarters confirmed captured... we\'ve cut their chain of command.',
              'But... the enemy\'s main force at the pass is on the move. They mean to retake the capital. Return to HQ for now.'
            ]
          }
        },
        'verg-3': {
          phase: 'Decisive Battle',
          name: 'Frozen Holdout',
          goal: 'Hold the capital until the main army arrives (150 s)',
          summary: 'Meet the enemy main force coming back to retake the capital. The blizzard cuts off supply, and shells are limited.',
          hold: { label: 'Defend the capital', banner: 'Defending — until the main army arrives' },
          bossName: '⚠ Snow-Camo Ace Heavy Tank',
          scenario: {
            prehead: pre('final', 'Planet Verg'),
            catch: 'Do not give back the city we took.',
            deck: 'The capital has fallen. But the elite troops of the pass are untouched, and they are marching across the snowfield to take it back.',
            lead: 'The blizzard cuts off all supply. Shells are limited and there are no repairs. Hold the heart of the capital until our main army arrives. '
              + 'They say the enemy has an ace: a heavy tank in snow camouflage. Keep your eyes on the heat signatures. '
              + 'Operation "Frozen Holdout" — in this city, we end the fight for Verg.'
          },
          mio: {
            tactical: 'The objective is to hold the center of the capital for 150 seconds until our main army arrives. Leave the yellow circle and the count stops. '
              + 'The blizzard cuts off supply. You have 40 shells, and you can recover a few from the wrecks of enemies you destroy.',
            enemies: 'Their main force is coming from all sides. Heavy tanks, and the snow-camo ace too. The ace is almost invisible from a distance.',
            terrain: 'Stand still for long and your tank chills, slowing the turret. Even while defending, keep moving now and then. '
              + 'Enemies crossing the lake will sink if they stop. During the blizzard, rely on the heat sensor.'
          },
          radio: {
            start: [
              'Mio here. Starting Operation "Frozen Holdout". Hold the capital for 150 seconds until the main army arrives.',
              'You have 40 shells. Don\'t waste them.'
            ],
            holdStart: [
              'Enemy main force sighted, contact imminent! Don\'t leave the circle!'
            ],
            complete: [
              'Our main army has reached the capital! The enemy is pulling back... the fight for Verg is ours.',
              'Well done, Commander. Really... thank you for holding on.'
            ]
          }
        }
      }
    },
    3: {
      name: 'Planet Castra',
      terrain: 'Industrial city',
      summary: 'The enemy home world, covered from pole to pole by factories and megacities. Under smog and acid rain, the homeland\'s regular army and militia lie in wait.',
      operations: {
        'castra-1': {
          phase: 'Preparation',
          name: 'When the Lights Go Out',
          goal: 'Capture the power plant and the rail terminal, escort the collaborator',
          summary: 'Shut down the power plant to silence the city\'s defense turrets, and see a dissident collaborator safely to the underground tunnels.',
          sites: [{ name: 'Power Plant' }, { name: 'Rail Terminal' }],
          escort: { meet: { name: 'Contact Point' }, to: { name: 'Tunnel Entrance' }, name: 'the collaborator' },
          scenario: {
            prehead: pre('first', 'Planet Castra'),
            catch: 'On the enemy\'s home world, we put out the lights first.',
            deck: 'At last we stand on the enemy\'s home world. The whole planet is buried in factories and cities, and the sky is thick with smog. Here we face not only tanks but militia who have taken up arms.',
            lead: 'First, shut down the power plant. The elevated turrets guarding the city run on its power. '
              + 'Then make contact with the dissident collaborator and escort them to the entrance of the underground tunnels. Their tunnel map will prove its worth in the battles ahead. '
              + 'Take the rail terminal, and it becomes our supply base. '
              + 'Do not forget: people live in this city. Destroy buildings carelessly, and they will turn against us. '
              + 'Operation "When the Lights Go Out" — we make this planet\'s night our ally.'
          },
          mio: {
            tactical: 'Three objectives: capture the power plant to the west and the rail terminal to the east, and escort the collaborator. '
              + 'There are three turrets on the elevated highway to the north. Capture the power plant and they\'ll lose power and stop. '
              + 'You\'ll meet the collaborator at the contact point northwest of HQ. Once together, move with them to the tunnel entrance.',
            enemies: 'This is the homeland\'s regular army. They have new main battle tanks, and infantry with anti-tank rockets. '
              + 'The infantry are fragile, but they pop out from behind buildings and from manholes without warning. You can run them over.',
            terrain: 'In the industrial city, the brightly colored houses and shops are civilian buildings. Destroy them and the people\'s cooperation drops. '
              + 'Low cooperation means more guerrillas in the final stage. Gray factories and warehouses can\'t be destroyed. '
              + 'Round fuel tanks explode when shot and take everything around them with them. The smog cuts visibility too, so be careful.'
          },
          radio: {
            start: [
              'Mio here. Starting Operation "When the Lights Go Out". Targets: the power plant, the rail terminal, and escorting the collaborator.',
              'Please don\'t fire on civilian buildings. We don\'t want the people against us.'
            ],
            complete: [
              'Power plant, rail terminal, collaborator escorted... all complete.',
              'Please return to HQ, Commander. Next up: the enemy\'s factory.'
            ]
          }
        },
        'castra-2': {
          phase: 'Decisive Battle',
          name: 'The Steel Ring',
          goal: 'Capture the two ring-road interchanges and the factory, destroy the prototype super-heavy tank',
          summary: 'Push into the factory district ringed by elevated highway, weave between the production lines, and strike the super-heavy tank under development.',
          sites: [{ name: 'West Interchange' }, { name: 'East Interchange' }, { name: 'Factory No. 7' }],
          bossName: '⚠ Prototype Super-Heavy Tank',
          scenario: {
            prehead: pre('second', 'Planet Castra'),
            catch: 'At the center of the ring, a monster awakens.',
            deck: 'An officer captured on Verg spoke a single name: Factory No. 7, where the enemy is building a prototype super-heavy tank. The factory is ringed by an elevated expressway.',
            lead: 'Turrets line the overpass; you will take fire from above and below. You cannot climb onto the overpass. Get inside through the gaps. '
              + 'Take the east and west interchanges and destroy the factory garrison, before the prototype is finished. '
              + 'Operation "The Steel Ring" — cut this ring, and the enemy\'s heart lies bare.'
          },
          mio: {
            tactical: 'Your targets are the east and west interchanges and Factory No. 7 at the center. The factory is surrounded by a ring of elevated highway. '
              + 'There\'s a gap in the middle of each side, and you can get inside through those. Once the factory garrison is down, the prototype should come out.',
            enemies: 'New tanks, infantry, and turrets on the overpass. The turrets fire down from up high. You can shoot back from below. '
              + 'And the prototype super-heavy tank: its armor and main gun outclass even the command tank.',
            terrain: 'The elevated highway is an impassable wall that also stops shells. Inside the factory, production lines stand in rows and you\'ll be fighting between them. '
              + 'Keep watching out for fuel tank explosions and civilian buildings.'
          },
          radio: {
            start: [
              'Mio here. Starting Operation "The Steel Ring". Targets: the east and west interchanges and Factory No. 7.',
              'Watch the turrets on the overpass. Get inside through the gaps in the highway.'
            ],
            complete: [
              'Prototype super-heavy tank confirmed destroyed... the enemy\'s trump card is gone!',
              'Please return to HQ. Only the capital is left.'
            ]
          }
        },
        'castra-3': {
          phase: 'Stabilization',
          name: 'The Last Light',
          goal: 'Capture the government building, patrol the city, destroy the guard that refuses to surrender',
          summary: 'Seize the heart of the capital and force the enemy government to surrender. But the fighting doesn\'t end there: patrol through IEDs and ambushes from below, and take the last stronghold of resistance.',
          sites: [{ name: 'Government Building' }, { name: 'Last Guard Stronghold' }],
          survey: [{ name: 'Patrol Point A' }, { name: 'Patrol Point B' }, { name: 'Patrol Point C' }],
          bossName: '⚠ Guard Captain\'s Tank',
          scenario: {
            prehead: pre('final', 'Planet Castra'),
            catch: 'A war does not end with a signature on a surrender.',
            deck: 'Its factories gone, the enemy government has shut itself in the government building at the heart of the capital. When it falls, the government will likely surrender. But that does not mean everyone will lay down their arms.',
            lead: 'Capture the government building and force the surrender. Then patrol the city and restore order. '
              + 'IEDs are planted in the roads, and ambushes come from below. How many of the people stand with us is what will count here. '
              + 'If some refuse to surrender, they are the last enemy. '
              + 'Operation "The Last Light" — we light this world once more.'
          },
          mio: {
            tactical: 'Your target is the government building at the heart of the capital. Capture it, and the enemy government should surrender. '
              + 'After that, go round the three patrol points in the city. ...Some units may refuse to surrender.',
            enemies: 'The building\'s garrison and guerrillas hiding in the city. How many guerrillas there are depends on the people\'s cooperation and whether you protected the collaborator.',
            terrain: 'IEDs are planted in the roads. They glow red when you get close; when you see one, shoot it to clear it. Driving over one does heavy damage. '
              + 'Infantry come out of manholes and subway exits. And to the very end, watch out for civilian buildings.'
          },
          radio: {
            start: [
              'Mio here. Starting Operation "The Last Light". Target: the government building.',
              'Watch for IEDs on the roads. If one glows red, shoot it.'
            ],
            complete: [
              'The guard has surrendered... fighting has stopped across all of Castra.',
              'Commander. We crossed three worlds to get here. ...This war is ours. Thank you, truly, for everything.'
            ]
          }
        }
      }
    }
  };

  // Lay `src` over `target`: strings and string lists replace, objects merge, lists of objects
  // merge item by item (sites, survey points)
  function overlay(target, src) {
    for (const [key, value] of Object.entries(src)) {
      const cur = target[key];
      if (Array.isArray(value) && Array.isArray(cur) && value.length && typeof value[0] === 'object') {
        value.forEach((v, i) => {
          if (cur[i]) overlay(cur[i], v);
        });
      } else if (value && typeof value === 'object' && !Array.isArray(value) && cur && typeof cur === 'object') {
        overlay(cur, value);
      } else {
        target[key] = value;
      }
    }
  }

  for (const planet of global.GameData.PLANETS) {
    const en = PLANETS_EN[planet.id];
    if (!en) continue;
    const { operations, ...fields } = en;
    overlay(planet, fields);
    for (const op of planet.operations) {
      if (operations[op.id]) overlay(op, operations[op.id]);
    }
  }
})(window);
