const quay = {
  name: 'Floodgate Quay',
  detail: 'Bellwether’s ferry quay, where the tide runs through hollow piles.',
};

const office = {
  name: 'Salt Office',
  detail: 'A brick weighing house with a pay hatch and a warm iron stove.',
};

const lantern = {
  name: 'Reed Lantern',
  detail: 'A signal tower on a raft of stone beyond the reed beds.',
};

const causeway = {
  name: 'Salt Causeway',
  detail: 'A seam of white limestone across the mud at the edge of the marsh.',
};

const ysra = {
  id: 'ysra-vale',
  name: 'Ysra Vale',
  detail: 'Bellwether’s ferrymaster. She reads the tide from the wear on the quay piles.',
};

const nera = {
  id: 'nera-voss',
  name: 'Nera Voss',
  detail: 'The Salt Office clerk. She keeps berth records and mortuary slips in different drawers.',
};

const packet = {
  id: 'red-packet',
  name: 'Red packet',
  detail: 'A wax-sealed packet addressed to Nera Voss at the Salt Office.',
};

const token = {
  id: 'ferry-token',
  name: 'Brass ferry token',
  detail: 'A round-trip fare. The brass is punched with the number four.',
};

const returnStub = {
  id: 'ferry-return',
  name: 'Ferry return stub',
  detail: 'A slip of blue pasteboard that covers the trip back to Floodgate Quay.',
};

const receipt = {
  id: 'salt-receipt',
  name: 'Salt Office receipt',
  detail: 'Nera Voss signed for the red packet, first bell.',
};

const openedPacket = {
  id: 'opened-packet',
  name: 'Opened red packet',
  detail: 'The broken seal exposes a slip that reads “No berth for Number Four.”',
};

const delivery = {
  id: 'deliver-packet',
  title: 'The red packet',
  detail: 'Take the red packet to Nera Voss at the Salt Office before the second bell.',
  status: 'open',
};

const signal = {
  id: 'reed-lantern',
  title: 'The light in the reeds',
  detail: 'Find who or what is answering from the Reed Lantern.',
  status: 'open',
};

const ysraClaim = {
  id: 'ysra-lantern-claim',
  speaker: ysra.id,
  text: 'Ysra says the Reed Lantern has been flashing since the night its keeper died.',
};

const ysraCode = {
  id: 'ysra-berth-code',
  speaker: ysra.id,
  text: 'Ysra says two short flashes and one long flash once meant that a berth was free.',
};

const ysraCauseway = {
  id: 'ysra-causeway-claim',
  speaker: ysra.id,
  text: 'Ysra says the steps behind the Salt Office lead to the causeway, where scored stones mark sound footing.',
};

const neraClaim = {
  id: 'nera-lantern-claim',
  speaker: nera.id,
  text: 'Nera says the mortuary entry reads “keeper’s berth vacant” and records no death.',
};

const lamps = {
  id: 'quay-light-pattern',
  text: 'From the quay, the Reed Lantern showed two short flashes and a long one.',
};

const ledger = {
  id: 'salt-ledger-four',
  text: 'The Salt Office ledger marks passenger berth four as closed by order of the keeper.',
};

const note = {
  id: 'packet-instruction',
  text: 'The slip inside the red packet reads “No berth for Number Four.”',
};

const mechanism = {
  id: 'lantern-mechanism',
  text: 'The Reed Lantern’s shutter is rotated by a float under the tower.',
};

const causewayStones = {
  id: 'causeway-stones',
  text: 'The third visible stone on the Salt Causeway rolls under pressure. Someone marked the safe stone with a scored arrow.',
};

const secondBell = {
  id: 'second-bell',
  text: 'The second bell rang while the red packet delivery was still pending.',
};

const lampQuestion = 'Ask Ysra about the Reed Lantern';
const cross = 'Take the ferry to the Reed Lantern';
const goOffice = 'Walk to the Salt Office';
const goQuay = 'Return to Floodgate Quay';
const goCauseway = 'Walk out to the Salt Causeway';
const deliver = 'Give Nera Voss the red packet';

export const opening = {
  scene: quay,
  narration: 'Someone has nailed a second set of tide marks to Floodgate Quay, a thumb’s width above the first. Under the shelter, ferrymaster Ysra Vale picks eelgrass out of a bell rope with a sail needle.\n\n“Nera Voss. Salt Office. Before the second bell, if you want a receipt.” She nods at the red packet in your coat pocket. A brass ferry token rides beside it.\n\nBeyond the reeds, a lamp flashes twice, waits, and gives one long burn. Ysra grips the rope until the light goes out. “That started the night the keeper died,” she says.',
  suggestions: [goOffice, lampQuestion, cross],
  inventory: [packet, token],
  facts: [lamps],
  claims: [ysraClaim],
  threads: [delivery, signal],
  cast: [ysra],
};

function ifNew(entry, entries) {
  return entries.some(({ id }) => id === entry.id) ? [] : [entry];
}

function hasItem(game, item) {
  return game.inventory.some(({ id }) => id === item.id);
}

function carryingPacket(game) {
  return game.inventory.find(({ id }) => id === packet.id || id === openedPacket.id);
}

function sceneSuggestions(game) {
  if (game.scene.name === office.name) {
    return [
      carryingPacket(game) ? deliver : 'Examine the Salt Office ledger',
      'Ask Nera about the Reed Lantern',
      goCauseway,
    ];
  }
  if (game.scene.name === lantern.name) {
    return ['Examine the lantern mechanism', 'Call down from the lantern', goQuay];
  }
  if (game.scene.name === causeway.name) {
    return ['Examine the causeway stones', 'Follow the causeway to the Reed Lantern', goOffice];
  }
  return [goOffice, lampQuestion, hasItem(game, token) ? cross : goCauseway];
}

function turn(game, narration, changes = {}) {
  return {
    narration,
    suggestions: sceneSuggestions(game),
    scene: null,
    facts: [],
    claims: [],
    threads: [],
    cast: [],
    gain: [],
    spend: [],
    ...changes,
  };
}

function travel(game, scene, narration, changes = {}) {
  const destination = { ...game, scene };
  return turn(destination, narration, { scene, ...changes });
}

function returnToQuay(game) {
  if (hasItem(game, returnStub)) {
    return travel(game, quay, 'Ysra hears the hail on her second pass. She tears your return stub down the crease and poles back to the quay. Two fish scales cling to the plank at your feet. She brushes them off after the boat is tied.', {
      spend: [returnStub.id],
    });
  }
  return travel(game, quay, 'From the tower, the scored stones pick out a dry-enough route to the Salt Office. Downhill from there the houses shelter the quay from the gusts. Ysra is coiling the ferry line.');
}

export function demoTurn(game, action) {
  const words = action.toLowerCase().replace(/[’‘]/g, "'");
  const place = game.scene.name;
  const onQuay = place === quay.name;
  const atOffice = place === office.name;
  const atLantern = place === lantern.name;
  const onCauseway = place === causeway.name;
  const hasPacket = carryingPacket(game);
  const isQuestion = /\b(ask|talk|speak|question|tell me|what|who|why|how|whether)\b/.test(words);
  const isTravel = /\b(walk|go|head|follow|return|leave|visit|enter|approach|climb|cross|take|catch|board|ride|back)\b/.test(words);
  const mentionsLantern = /\b(lantern|tower|light|lighthouse)\b/.test(words);

  if (/\b(don't|do not|without)\s+(open|hand|give|deliver|spend|board)\b/.test(words) && !isTravel) {
    return turn(game, 'The first bell has left the gulls arguing above the roofs. There is still time to keep your own counsel.');
  }

  if (isQuestion) {
    if (atOffice && /\b(nera|clerk)\b/.test(words) && /\b(packet|receipt|owe|delivery)\b/.test(words)) {
      const deliveryRecord = game.threads.find(({ id }) => id === delivery.id);
      if (deliveryRecord?.status === 'resolved') {
        return turn(game, 'Nera turns the ledger and touches the entry with the wood of her pencil. “I have the red packet. It was entered here when you brought it. You owe me nothing.” She turns the ledger back before the next person reaches the hatch.');
      }
      return turn(game, 'Nera holds her hand out over the pay hatch. “The red packet is still due. I mark it when it reaches this side of the desk.”');
    }
    if (onQuay && /\b(ysra|ferrymaster|lantern|causeway|light|signal|keeper)\b/.test(words)) {
      const prior = game.claims.some(({ id }) => id === ysraCode.id);
      const narration = prior
        ? 'Ysra turns the sail needle around and pulls the last grass loose with its eye. “Two short, one long. A free berth, if they still use my book. Ask Nera which book they’re using now.”'
        : 'Ysra draws two short strokes and a long one on the bench with her thumbnail. “A free berth. That’s what it meant when I ran the shore lamps.” She rubs the strokes smooth. “If you go out, keep to the scored stones. The causeway comes up behind the Salt Office.”';
      return turn(game, narration, {
        claims: [...ifNew(ysraCode, game.claims), ...ifNew(ysraCauseway, game.claims)],
      });
    }
    if (atOffice && /\b(nera|clerk|lantern|causeway|light|signal|keeper)\b/.test(words)) {
      return turn(game, 'Nera takes her glasses off to read the mortuary sheet. “Keeper’s berth vacant. That’s all it says. A death gets a name and a box around the date.” She sets a lead weight over the corner. “The steps behind the office will put you on the causeway.”', {
        claims: ifNew(neraClaim, game.claims),
      });
    }
    if (atLantern) {
      return turn(game, 'Your question carries all the way to the far side of the tower. Water knocks once on a stone below. The room at the top is empty. The shutter keeps opening and closing.');
    }
  }

  if (!isQuestion && /\b(open|unseal|break|tear|read)\b/.test(words) && /\b(packet|seal|letter|envelope)\b/.test(words)) {
    if (!hasPacket) {
      return turn(game, 'The red packet is out of your hands. The pocket it occupied still holds its square crease.');
    }
    if (hasPacket.id === openedPacket.id) {
      return turn(game, 'The slip still says “No berth for Number Four.” Held against the light, the paper shows a tally of initials along the edge, pressed in without ink.');
    }
    return turn(game, 'The wax breaks with a sound like a seed hull under a tooth. Inside is a single slip of rough paper. “No berth for Number Four.” The downstroke of the F has torn a little hole.', {
      facts: ifNew(note, game.facts),
      gain: [openedPacket],
      spend: [packet.id],
    });
  }

  if (!isQuestion && /\b(give|hand|deliver|offer|pass)\b/.test(words) && /\b(packet|letter|envelope)\b/.test(words)) {
    if (!hasPacket) {
      return turn(game, 'The packet is already out of your hands.');
    }
    if (!atOffice) {
      return turn(game, 'Nera Voss is up at the Salt Office. Through its little square window, somebody is turning the pages of a ledger.');
    }
    if (game.facts.some(({ id }) => id === secondBell.id)) {
      return turn(game, 'Nera opens the hatch just enough to take the packet. She writes “LATE” in the ledger and slides it under a stone. “I can put it on tomorrow’s sheet. The first-bell receipt pad is locked away.”', {
        threads: [{ ...delivery, detail: 'Nera accepted the packet after the deadline and deferred filing it until tomorrow.', status: 'resolved' }],
        spend: [hasPacket.id],
      });
    }
    const seal = hasPacket.id === packet.id
      ? 'Nera checks the wax with the pad of a finger.'
      : 'Nera fits the two halves of the wax together. “I’ll put down how it came.”';
    const next = { ...game, inventory: game.inventory.filter(({ id }) => id !== hasPacket.id) };
    return turn(next, seal + ' She dates a receipt by the first bell, slides it to the edge of the hatch, and puts the red packet under a stone. Her next customer can wait outside for a minute.', {
      threads: [{ ...delivery, detail: 'Nera Voss accepted the packet and signed a receipt.', status: 'resolved' }],
      gain: hasItem(game, receipt) ? [] : [receipt],
      spend: [hasPacket.id],
    });
  }

  if (!isQuestion && (/\b(ferry|boat|token)\b/.test(words) && (isTravel || /\b(pay|spend|offer|use)\b/.test(words)))) {
    if (atLantern) {
      if (hasItem(game, returnStub)) {
        return returnToQuay(game);
      }
      return turn(game, 'Ysra looks up from her oars. “I can bring back the fares I brought out.” She points her pole at the scored causeway stones.');
    }
    if (!onQuay) {
      return turn(game, 'The ferry ties up at Floodgate Quay. Its bow bell is audible between the buildings when the wind drops.');
    }
    if (!hasItem(game, token)) {
      return turn(game, 'Ysra leaves her palm open for a moment. “One fare each round trip. I’ve got number four in the box already.” She nods uphill. “Nera can show you the path to the causeway.”');
    }
    return travel(game, lantern, 'Ysra knocks your brass token against the gunwale, drops it in her fare box, and passes you a blue return stub. The ferry slips through a channel just wider than its oars. At the tower she draws even with a stair polished green by the water. “Hail me off the landing when you’ve had your look.”', {
      gain: hasItem(game, returnStub) ? [] : [returnStub],
      spend: [token.id],
    });
  }

  if (!isQuestion && isTravel && /\b(salt office|nera|office|weighing house)\b/.test(words)) {
    if (atOffice) {
      return turn(game, 'The iron stove ticks as it warms. Nera has left the pay hatch propped open.');
    }
    return travel(game, office, 'The floor of the Salt Office slopes toward the pay hatch. Behind it, Nera Voss holds down two curling pages with a brick wrapped in felt. She looks first at the pocket with the packet, then at the date on her page.', {
      cast: ifNew(nera, game.cast),
    });
  }

  if (!isQuestion && isTravel && /\b(quay|floodgate)\b/.test(words)) {
    if (onQuay) {
      return turn(game, 'The quay boards bow under the mooring rope as the ferry rises on a little chop. Ysra makes a fresh turn on the cleat.');
    }
    if (atLantern) {
      return returnToQuay(game);
    }
    return travel(game, quay, 'The lane comes out beside the fresh tide marks. Ysra has set a chipped enamel cup on the mooring post to keep its place.');
  }

  if (!isQuestion && isTravel && mentionsLantern) {
    if (onCauseway) {
      return travel(game, lantern, 'The scored stones make a line just raised above the mud. Behind the last one a rusted ladder runs up the tower wall. From the landing you can see the shutter move against the glass.');
    }
    if (!atLantern) {
      return turn(game, 'Reeds hide the tower’s lower half. The route by water starts at Floodgate Quay. A bank of white stones shows through behind the Salt Office.');
    }
  }

  if (!isQuestion && isTravel && /\b(causeway|stone path|limestone)\b/.test(words) && !onCauseway) {
    return travel(game, causeway, 'Steps behind the Salt Office descend into the reeds. Below them the causeway shows as a seam of white stones under a finger of water. An arrow scored into one stone points sideways. There is room to try a foot there.');
  }

  if (atOffice && /\b(ledger|record|book|entry|paperwork)\b/.test(words)) {
    return turn(game, 'Nera puts one finger on the line she’s willing to show. Berth four has been ruled off in dry red ink. The note in the margin says the keeper ordered it. A loose thread from the felt brick has caught in the dried ink.', {
      facts: ifNew(ledger, game.facts),
    });
  }

  if (onCauseway && /\b(examine|look|inspect|test|stones)\b/.test(words)) {
    return turn(game, 'A loose stone tips under the least pressure and settles with a cough of black mud. The scored arrow points around it to a flatter stone just on the waterline.', {
      facts: ifNew(causewayStones, game.facts),
    });
  }

  if (atLantern && /\b(examine|look|inspect|shutter|mechanism|watch)\b/.test(words)) {
    const settled = game.threads.some(({ id, status }) => id === signal.id && status === 'resolved');
    return turn(game, 'A narrow shaft runs through the floor to a cork float under the tower. Each swell takes up the slack and turns the shutter: twice quickly, then once across the wide slot. There’s a spare slot cut in a place the pin cannot reach.', {
      facts: ifNew(mechanism, game.facts),
      threads: settled ? [] : [{ ...signal, detail: 'A tide-driven shutter makes the flashes at the Reed Lantern.', status: 'resolved' }],
    });
  }

  if (atLantern && /\b(call|hail|shout|listen)\b/.test(words)) {
    return turn(game, 'The voice you send down the stone shaft comes back in two thin parts. Ysra’s oars knock together somewhere in the reeds.');
  }

  if (/\b(wait|stay|linger)\b/.test(words) && /\bsecond bell\b/.test(words)) {
    if (game.facts.some(({ id }) => id === secondBell.id)) {
      return turn(game, 'The second bell’s rope is still damp where the ringer gripped it. There is only wind in the belfry now.');
    }
    if (game.threads.some(({ id, status }) => id === delivery.id && status === 'open')) {
      return turn(game, 'The second bell has a chipped note. It sounds once over the roofs and once from the water. At the Salt Office somebody slides the first-bell receipt pad into a drawer.', {
        facts: [secondBell],
        threads: [{ ...delivery, detail: 'The second bell has rung. Ask Nera what she can do with a late packet.' }],
      });
    }
    return turn(game, 'The bell rope puts on a little weight in the breeze. Somewhere behind the Salt Office, somebody drops a crate.');
  }

  if (/\b(token|inventory|possessions|pocket)\b/.test(words)) {
    return turn(game, hasItem(game, token)
      ? 'The brass ferry token has a four punched straight through it. The edge opposite the hole has been rubbed almost round.'
      : 'There is no brass token in your pocket. Its weight was little enough until it was gone.');
  }

  if (/\b(think|reflect|consider|remember|plan|recall|hmm)\b/.test(words)) {
    if (game.facts.some(({ id }) => id === mechanism.id)) {
      return turn(game, 'The shutter made its three flashes wherever the tide met the float. It takes a person to cut the slots that make up the signal.');
    }
    if (game.claims.some(({ id }) => id === neraClaim.id)) {
      return turn(game, 'The light at the Reed Lantern is real. So far you have Ysra’s memory of a death and Nera’s description of an empty berth.');
    }
    return turn(game, 'Three flashes from the reed beds. There was enough time between the last two for somebody to put a hand on a rope and think better of pulling it.');
  }

  if (onQuay) {
    return turn(game, 'Ysra puts the sail needle handle-first through a buttonhole. A board on the ferry settles under her weight, and she pauses there with one foot still on the quay.');
  }
  if (atOffice) {
    return turn(game, 'Nera has left the hatch open. A pencil rolls toward you along its slope and catches against a raised nail.');
  }
  if (atLantern) {
    return turn(game, 'Under a crossbeam a strip of old tin keeps shifting in the draft. The shutter turns again as the tower takes the wash of the tide.');
  }
  if (onCauseway) {
    return turn(game, 'A bubble pushes up through a crack beside the stone. Past the last reed bed the tower’s landing shows a rung above the water.');
  }
  return turn(game, 'The sounds of the marsh thin for a moment between gusts. The nearest clear route leads back toward Floodgate Quay.', {
    suggestions: [goQuay],
  });
}
