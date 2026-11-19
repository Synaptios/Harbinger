const aliceScenes = ['bakehouse', 'guildInspection', 'landing', 'shutter', 'shutterNotice', 'notice', 'marketTally'];
const martinScenes = ['bakehouse', 'guildInspection'];

export const storyAvenues = [
  {
    id: 'bread-supply',
    title: 'Who gets bread in the morning',
    actorId: 'alice',
    narrationTopics: ['bread', 'loaf', 'apprentice', 'wood'],
    premise: 'Alice makes room for people who need bread before she knows what the next morning’s baking will bring.',
    stages: [
      {
        afterTurns: 2,
        description: 'Alice starts with the apprentice and considers who else might have to wait for bread.',
        sceneIds: aliceScenes,
        paragraph: 'Alice counts on her knuckles. “My boy needs to eat before he starts work. And there’s the ones who have to be out looking for work before I can sell them a loaf.” She starts counting again with those people included.',
        report: '“I started counting who needs bread early,” Alice says. “My boy first. Then the people who have to be out looking for work before I can sell them a loaf. I went back and counted those people too.”',
        observation: {
          title: 'Alice reckons who will need early bread',
          text: 'Alice counted her apprentice and those looking for work early among the people she wants to have bread.',
        },
      },
      {
        afterTurns: 8,
        description: 'Alice separates bread to keep back from what she could afford to sell.',
        sceneIds: aliceScenes,
        paragraph: 'Alice takes a scrap of paper from her apron and folds it down the middle. She marks one half for bread to sell and the other for what she means to keep back. The second half takes more space than she expected. She looks at it a while before folding the halves together.',
        report: 'Alice takes the folded scrap from her apron. “I made two tallies. One for what I might sell, one for what I’d keep back for morning. The second one took more room than I thought it would.”',
        observation: {
          title: 'Bread for sale and bread to keep back',
          text: 'Alice drew up separate tallies for bread she could sell and bread she hopes to keep back.',
        },
      },
      {
        afterTurns: 18,
        description: 'Alice decides whose share comes first, accepting the cost to her own takings.',
        sceneIds: aliceScenes,
        paragraph: 'Alice opens the folded reckoning. “If there’s less than I’ve allowed for, the boy and the houses waiting on account still take their share first.” She draws a line through the sum on the side marked for sale. “Let that be the short column.”',
        report: '“I settled which side could come up short,” Alice says. “If there’s less to go round, my boy and the houses on account still come first. I crossed through what I meant to sell.”',
        observation: {
          title: 'Alice takes the shortage out of her sales',
          text: 'Alice said that if there is a shortage, she means to reduce what she sells before cutting shares for her apprentice or customers who buy on account.',
        },
      },
    ],
  },
  {
    id: 'guild-accountability',
    title: 'Who can answer for a line in the book',
    actorId: 'martin',
    narrationTopics: ['witness', 'account', 'report', 'record'],
    premise: 'Martin makes the difference between a decree, a report, and an available eyewitness matter in the guild’s work.',
    stages: [
      {
        afterTurns: 2,
        description: 'Martin makes a visible place for a witness’s name even if it has to sit empty.',
        sceneIds: martinScenes,
        paragraph: 'Martin squares a strip of paper against the edge of the book. He rules a short line at the foot of it and leaves the space above it clear. “That one is for the eyes that saw it,” he says. “It can stay empty until someone can answer for the name.”',
        report: '“I ruled a separate line for a witness,” Martin says. “It’s empty. I mean to keep it that way until someone can give me a name and say what they saw.”',
        observation: {
          title: 'Martin leaves the witness line empty',
          text: 'Martin ruled a separate line for an eyewitness and left the space for the name unfilled.',
        },
      },
      {
        afterTurns: 8,
        description: 'Martin tests the distinction on the crier’s account of the proclamation.',
        sceneIds: martinScenes,
        paragraph: 'Martin sets his pen beside the line he has ruled. “From the crier,” he says, trying the words aloud. He writes them in the space above the line. “I heard him give it out. I couldn’t tell you who first saw what he told us.”',
        report: 'Martin says he put the proclamation down as the crier’s report. “His voice is what I heard. If anyone asks who first saw what he told us, I don’t have a name to give them.”',
        observation: {
          title: 'The crier named as the source',
          text: 'Martin entered the crier as the source and said his own hearing of the proclamation gives him no firsthand account of what it reported.',
        },
      },
      {
        afterTurns: 18,
        description: 'Martin takes responsibility for keeping a place for an account someone can answer for.',
        sceneIds: martinScenes,
        paragraph: 'Martin lifts the strip and reads back the words under his own breath. Then he sets it between the leaves where it will be found again. “If someone comes who saw it, they can give me their own words. I’ll leave it legible who gave me the first account, whoever comes after.”',
        report: '“I left the slip in the book,” Martin says. “Anyone who reads it can see that it came from the crier. If a witness comes after, I’ll hear them in their own words and leave the first account as it stands.”',
        observation: {
          title: 'Martin preserves the first account’s source',
          text: 'Martin kept the attributed report in his book and said he would record a later eyewitness in their own words while leaving the first account’s attribution legible.',
        },
      },
    ],
  },
  {
    id: 'flour-route',
    title: 'Keeping the flour accountable in transit',
    actorId: 'alice',
    narrationTopics: ['sack', 'mark', 'flour', 'load'],
    premise: 'Alice looks for a way to keep the flour identifiable when it changes hands and is willing to do that work herself.',
    stages: [
      {
        afterTurns: 2,
        description: 'Alice identifies the weak link between a mark on a sack and somebody recognizing it after a handoff.',
        sceneIds: aliceScenes,
        paragraph: 'Alice brushes a stroke of flour from her sleeve. “See how little it takes to lose a mark. A sack can go right past the person who’s looking for it after that.” She turns her palm up, as if weighing what it would cost to put the stroke back.',
        report: 'Alice says she got to thinking about what happens when a sack’s mark rubs away. “The very person looking for it could watch it go by and never know. I’d like a way to tell one sack from another after they’ve moved them.”',
        observation: {
          title: 'Alice worries about marks surviving the handoff',
          text: 'Alice pointed out that a missing or rubbed mark could make a sack hard to identify after it is moved.',
        },
      },
      {
        afterTurns: 8,
        description: 'Alice tests a separate record of marks with a sample that makes no claim about a particular sack.',
        sceneIds: aliceScenes,
        paragraph: 'Alice draws a little forked mark alongside a plain stroke on a scrap of paper. She folds the corner over to see how much of the pair is still legible. “If they only have half of one mark to go by, I want them to have something to hold it against.”',
        report: 'Alice shows two sample marks on the scrap she carries. “I tried folding the corner over these. A copy would give us somewhere to look when someone comes back with half a mark to go on.”',
        observation: {
          title: 'Alice tries keeping a copy of the flour marks',
          text: 'Alice tested a small written copy of sample marks as a way to check a partly obscured mark.',
        },
      },
      {
        afterTurns: 18,
        description: 'Alice takes on the work of copying the marks before a future handoff.',
        sceneIds: aliceScenes,
        paragraph: 'Alice flattens the corner she folded and pockets the scrap. “Next load I have to account for, I’ll copy the marks myself before it changes hands. Whoever takes it on can see how I counted. Then if one sack goes missing, there’s a place to start looking.”',
        report: '“I’ve settled what I’ll do with the next load I have to account for,” Alice says. “I’ll copy the marks while the sacks are together, so the person taking them on can check my count.”',
        observation: {
          title: 'Alice offers to account for the flour marks',
          text: 'Alice said she would copy the marks on a future load before it changed hands so another person could check her count.',
        },
      },
    ],
  },
];
