import { createHash } from 'node:crypto';
import { pacingDirection } from './editorial-direction.mjs';

const minimum = 200;
const ceiling = 300;
const decisionHeadings = new Set([
  'The last entry', 'Thames landing', 'The market tally', 'The order on the shutter', 'The price of flour', 'Two hours before dawn',
]);
const routineExplanations = new Set(['The guild tally']);
const inactiveDevelopments = new Map([
  ['The folded order', 1],
  ['The reason for the flour', 0],
  ['The price of flour', 1],
  ['Two hours before dawn', 1],
]);
const commonWords = new Set('about after again also away back before been both came come could does down each enough from have here into just know left like little make many more much near only over room said seem some than that their them then there these they thing this those time turn upon very want were what when where which while will with word would'.split(' '));

const developments = {
  'Alice’s bakehouse': [
    'The light from the door falls short of the oven. Around the mouth of it the brick is black and shiny at the height of Alice’s shoulder. She can reach in with the peel without looking. She has to look when she adds a delivery to the book. Flour lies in the crease between the pages, and every time she turns one a little more settles on the table.',
    'Martin has room for a date, a name and a number on each line. Alice’s deliveries are made with a door half open and somebody generally asking if the loaf can go on the account. The distance between those two sorts of work is the width of the table. By the time the crier reaches the next turning, the delivery book is still lying open between the scales and the bread.',
  ],
  'The last entry': [
    'The guild room makes a small sound carry. A ring against the table, a heel under a bench, each is quite distinct. Martin can hear the oven account here down to the last sack. The people who take their bread from Alice have no place at this table unless their names go into the book.',
    'The seal lies on its side, close enough to roll. The delivery column ends at a ruled line and there is room to write below it. Alice can see exactly how much room. Her hand stays beside the binding, where it was when she helped carry the book in.',
  ],
  'The key comes off the nail': [
    'The license is high enough to read across the lane. The summons has been set beside it, and a person coming to see whether there will be bread tomorrow can read both from the same patch of paving. The paper gives the carter an hour and a place to be. Alice has the rest of the evening for what is left in the oven.',
    'The two halves of the loaf are different sizes. Alice takes a little from the broad half and wedges it beside the narrow one before she hands them across. One child gets flour all over the front of a coat that was clean a moment ago. The key she has taken down lies quiet in her pocket while she turns toward the next person.',
  ],
  'Thames landing': [
    'The path down to the landing has a groove down the middle. A cart wheel can follow it as readily as a hand follows a seam in cloth. At the water the groove ends among stones the tide has darkened. The carter has found the few places wide enough to set a sack down without getting its underside wet.',
    'Alice watches the carter get the edge of the cover under his thumb. He can make a square of cloth stay put with a weight the size of his fist. The marks on the sacks are easier to see from where she stands than from the street. Across the whole landing there is scarcely any clean, level ground on which to open a book.',
  ],
  'Back at Thames landing': [
    'Out by the water again, the path is harder underfoot than the strip behind the storehouse. The landing comes back into view a board at a time. The first thing to carry clearly across it is the knock of wood against wood. Voices have to travel farther to be understood.',
  ],
  'A key at dusk': [
    'The sound of the bell thins between the houses. There is enough light left to see the key in Alice’s hand. On an ordinary evening she could already have it turned in the lock before someone in the lane thought to call after her. The boy’s account has given her a reason to wait outside and listen.',
  ],
  'The sealed shutter': [
    'The bar has been fitted across the same boards Alice has opened every working morning. She knows where the latch catches and where to lift with her wrist. The wax sits at a height that makes the folded paper easy to see from the lane. To find out what the paper says, someone will have to go close enough to read it.',
  ],
  'The order on the shutter': [
    'The letters get smaller toward the bottom of the sheet. There is nothing down there about a cart or its cargo. Whoever wrote the order had room to put down what happened at the inspection and say what the guild would do about it. In that space there are enough words to keep a bakery closed.',
    'Alice can stand near enough for the key to reach, even now. With the bar in its place she has no use for the practiced turn of the wrist that used to bring her straight inside. Whatever warmth the oven still holds is on the other side of the boards. From here there is no way to put another stick of wood on.',
  ],
  'The price of flour': [
    'At the mouth of the lane the last daylight is just strong enough to show the difference between wet paving and dry. Alice has to pass the place where she usually leaves a little wood ready for morning. Carrying it is work a person can agree to do now. The question of a door she is allowed to open will take longer to answer.',
    'Come at first light. She has made the hour clear, and she has told you what your hands are for. She leaves the rest for herself to see to. There is no oven promised in that division of the work. There is enough for two people to know when they ought to turn up and what they can carry when they do.',
  ],
  'The long way home': [
    'Alice has worn a hollow into the boards beside the threshold by standing there at the end of the day. The hollow is still in the wood with the shutter down. From the turning, the paper is large enough to see, small enough that its words remain with whoever goes back to read them.',
  ],
  'The market tally': [
    'The stalls make a crooked line. A man with a cart has to choose which stretches of it he can pass without lifting one wheel. Close to the tally, those crossings are known by the sound they make. It takes more work to tie a mark in wax to one of the loads. The man tending the tally has to wait for a mark he can compare.',
    'A hired cart is easy to see going by. Once it has turned the corner, all that remains at the stall is what somebody marked down. The carter can put a customer to a hire already. He still needs a way to tie that hire to the place where the load was left. Until the tally is ready, the marks only take you part of the way.',
  ],
  'A warning by the stall': [
    'The runner has a piece of paper and a route that takes him past the carters. That is plain from the way he asks for the marks. His words reach people two stalls away. The folded copy is closer at hand after he goes, and the question of what the guild actually put in writing can be settled at that spot.',
    'The tally is ready at last, but now there are two things on the stall worth asking to see. One belongs to the carters and one has come from the guild. The wax can tell you about a cart. The paper can tell you what the guild has required. You have heard the warning either way. The copy is still folded.',
  ],
  'The folded order': [
    'Set flat, the copy takes up about as much space as one loaved board. The important words sit well inside the crease. They account for the ledger that failed to arrive. The baker’s answer comes from a different measure altogether, from when he draws his last batch and when he needs heat for his own bread again.',
    'Until you read the paper, what you had was the runner’s account of the order. Here are the missing ledger and the reason the guild gives for keeping the oven closed. The baker can spare time at his own oven if Alice brings wood. That would get bread out in the morning. The order on the old oven would still be there.',
  ],
  'Two hours before dawn': [
    'The chalk marks around Alice’s name are from people who have to do their work at different hours in the same narrow place. Three dozen loaves will fit the space the baker left her. That is a size of problem she can put her hands to. She studies the board while talk goes on about where the wood is to come from.',
    'The board has a place for Alice’s name now. Anyone looking for the first loaf will have to reckon with a different oven and an earlier start. There is room for three dozen, if the wood comes. The boy has no part in arranging the hours or carting the fuel. Alice has thought to put his loaf first all the same.',
  ],
  'After the market': [
    'The stone holds a white corner of the paper flat where a creased edge wants to lift. Anyone still at the stall can lean in and read. From the way out of the market you can see where Alice is heading, to the corner where the rows of stalls give way to the road home.',
  ],
  'A sorted tally': [
    'On a single sack, a mark hardly takes any room. With the sacks laid together, the width of a tally is all it takes to put one in the next sack’s place. The porter can do the counting faster now the marks are in an order he can follow. The next person through the door will find him farther along in his work.',
    'For the porter the mistake is worth a day’s wages. From the doorway it would only look like a man stopping halfway through his count. The work is easier to follow beside him, where each mark has its sack underneath it and there is room to sort out a pair without losing track of the rest.',
  ],
  'The guild tally': [
    'The tally has to survive a person coming in from outside and asking where one sack went. It has to work for the porter even when the sack next to it is of the same weight. The simplest things on the shelf, the mark and the place where the mark is entered, are the things he can put his hand on while he explains.',
    'The chalk gives him a way to find something again after he has put it down. From that one mark he can take you as far as the shelf and the sack he put there. Beyond the door there are people who know different parts of the work. He leaves those parts to them when he speaks of the tally.',
    'There is as much room to stand beside a chalk mark as there is beside a sack, once the sacks are in their places. From out in the yard you would have heard an answer and still had no idea what the porter was pointing at. Here there is space between the shelf and the tally for a person to see both.',
  ],
  'Alice on the proclamation': [
    'Outside, somebody repeats the account in a lower voice than the crier used. It carries as far as the door. Alice has flour to rub out of the little lines at the base of her fingers. A person with something to set on the counter can ask her for a loaf. What came through the door that morning was a man’s voice carrying the words he had been given.',
  ],
  'Martin on the proclamation': [
    'There is a practical difficulty in waiting for every account to be confirmed. A guild still has hours to set and ovens to license in the meantime. Martin holds the place where his finger meets the edge of the book. Whatever he calls the proclamation in conversation, if it goes under his hand it has to carry the kind of authority it arrived with.',
  ],
  'The guild’s account': [
    'For Martin there is a difference between a man saying something at the board and a line he can look up again after that man has gone home. Both can affect what he does. The book makes him keep the difference. The space at the edge of a page is narrow enough that he has to make a decision about every word he puts there.',
  ],
  'No news from Dover': [
    'The space in a record for the date a messenger came is no wider than a finger. When it is empty, a person can make all sorts of journeys in their head and still have an empty space before them. Martin keeps the last filled line under his hand as he answers.',
  ],
  'Between the two of you': [
    'From the flour board Alice can see feet pass the bottom of the doorway before their owner is in sight. She keeps the ends of her fingers flat for a moment. A name said in this room would carry out into the lane if the door were open the right way. There is work enough on the board to occupy her until it is possible to speak softly.',
  ],
  'The reason for the flour': [
    'The board is white where the last loaf lay. Alice speaks across that short space, at the pitch she would use with somebody who had bent to look at the bread. There is a witness in the account she gives you, somebody whose eyes were on the Tower. He is a different source from the people who have spent the morning repeating the wedding story throughout the shops.',
  ],
  'A name left out': [
    'Martin can see the bread go past him. What he gets to hear about the shipment is up to the person he asked. There is just enough time in the exchange for a name to be said and written, and then the moment goes by. The heel Alice leaves behind is small enough to be passed over without comment.',
  ],
  'A name entered': [
    'The pen is ready again before Martin has room to know what he will make of the account. He has heard it from the clerk. The man who saw the Tower is somewhere else. Alice leaves the knife where its blade can lie flat instead of sliding into the flour at the edge of the board.',
  ],
  'What Alice remembers': [
    'Wind off the landing moves the edge of the cloth when it lifts. Alice keeps a corner folded in her fingers. She tells you what she noticed when Martin asked about the shipment. It matters to her what happens after a promise, when there is an actual name to write down and somebody standing there waiting for it.',
  ],
  'What the carter said': [
    'The cloth on the sacks gives a short snap in the wind. Alice waits for the sound to go by and gives you the little that was actually said. It is a phrase short enough to remember whole. The river keeps on making it difficult for anyone a few paces away to hear even that much clearly.',
  ],
  'A scribe’s statement': [
    'The fold runs almost to the date. When the paper lies flat, the scribe’s name is in a separate place at the bottom. Whoever brought it has taken care of the corners. What Alice passes across is the part you can read for yourself. The account in it is the scribe’s claim about what he saw.',
    'The signature gives you a name to put beside the account if it has to be told again. You can see what the man put under his own name. The ink has no way to show where he stood or who else was there. For that, there is still somebody who would have to answer a question in person.',
  ],
  'Alice intervenes': [
    'The binding has a split at the corner nearest the scales. Alice’s hand covers it now. There is room to pass the book over the board, the room a person would need to lift it. For the moment the passage between the scales and the flour board is as far as the movement goes.',
    'The hand on the ledger is the one she uses to keep the board from sliding when she cuts. It can stay there a long time with very little effort. The point at issue is small enough to settle in a few words and large enough that she has stopped the work she was doing to settle it.',
  ],
};

const settings = {
  bakehouse: [
    'The face of the scales has gone dull with use. There is a bright streak where the nearest weight has been moved by the same finger, morning after morning. The bowl of the scales hangs just far enough above the board for flour to collect underneath it. The flour feels the passage of somebody near the table before the bowl does.',
    'Along the doorpost the wood is worn pale by hands bracing themselves on the way through. With the door ajar it takes little effort to hear the lane. The same change of air makes the corner of a ledger page lift. The work inside has to go on at a pace that allows for the doorway and whatever comes through it.',
    'The dust gathers in a thin ridge where the board is held against the wall. Farther along there is a clean patch reserved for bread that has already cooled. A person doing the work knows which part of the board may be leaned on. Near the ledger the flour has been wiped away in the shape of a forearm.',
    'The peel is the longest piece of wood in the room. The business of getting it level, clearing the crust and bringing it back out occupies the width of the bakehouse. A short conversation can fit in the time it takes to draw breath with the peel set down. Anything longer asks somebody to stand out of the way.',
    'The bakehouse is deep enough for the daylight to peter out halfway across the floor. In the darker half you can make out the fire by the lines of mortar it lights. The part of the room where business is done sits just inside the daylight, near enough to see a coin for what it is.',
    'At the nail above the board the wall is worn where the spare cloth hangs. The cloth has been patched from a piece with a finer weave. On one side the tear is hard to find. Held against the light, the stitches tell you exactly where it was.',
    'Heat reaches the edge of the table by degrees. The nearer scale weight has been resting in it long enough to take some of the warmth. There is still cold air by the floor and along the inch of wood beneath the door. It is a room you could cross in four steps and pass through two kinds of weather.',
    'The loaves on the board lean slightly where their bottom crusts have swelled. Anyone dividing them would have to take that into account. Alice has set the board far enough back to keep the bread out of a sleeve. Along the front edge there is room for an open hand and whatever somebody has brought to pay.',
    'The working end of the table has been scraped clean in small arcs. Farther from the oven the old cuts in the wood show through again. A book will sit open there without much trouble. Anything lighter than a sheet of paper needs the weight of a hand when the door is open.',
  ],
  guild: [
    'The tables are heavy enough to take the pressure of somebody writing hard with a pen. Under an elbow the grain catches at a sleeve. The guild has left a stretch clear near the seal so a book can be laid flat and turned without touching the wax. It is a place where even a quick answer can end with someone having to sign for it.',
    'The shutters let in light down the length of the table. Near the seal it is easy to see how wet the last stroke of ink is. By the end of the bench the faces of the people who wait are harder to see. Voices from either end of the table carry to the door.',
    'The bench has been pushed against the wall to give people room to approach the table. Anyone sitting there can watch the hand that writes. The page itself is turned away. A person who wants to know what goes down can ask for the words to be read aloud while there is still time to dispute them.',
    'Between the legs of the table the floor is scratched by a chair dragged back the same distance each time. To sit there is to face everyone who comes through the door. The light falls over the shoulder of whoever has the book before them. A name in the margin can be seen more clearly from that chair than from anywhere else in the room.',
    'One of the shutters closes too loosely and rattles twice when the wind reaches it. The paper at the table lifts a little with the first sound. A thumb on the corner is enough to hold it. You can hear a voice from by the seal all the way to the far wall.',
  ],
  landing: [
    'The Thames takes the colour of the sky a little farther out than the end of the landing. Close to the steps it holds small scraps of leaf and wet straw. A boat nudges at the wood long enough to give it a polished edge. Anyone trying to be heard above it has to pick the right moment to speak.',
    'The marks a wet rope makes on the boards go dark first and then pale again. A fresh mark lasts long enough to show where somebody set a foot for leverage. There is plenty to see a few inches above the river without knowing much about where the boats have been or where the loads will go next.',
    'From the landing, the windows on the lane sit high above the boards. Down here there is nowhere to put a book on a level surface without using a sack or an overturned box. The people who work at the river arrange things so their hands can stay free when a load is moving.',
    'At the lowest step the wall has a line on it the water can just reach. There are little shelves in the stone farther up, places a passing hand can use to steady a load. They are too shallow to set anything on. A person who came down here with paper would need to keep hold of it.',
    'There is a run of boards that has worn almost smooth beneath the feet of people carrying things toward the boats. Away from it the wood is still rough. River water in the joints makes the shade beneath them look deeper than it is. On the dry side there is room enough to stand out of the way.',
    'The river has room for the little sounds of the landing until two of them arrive at once. A knock of wood from the water can drown a footfall on dry stone. Far enough up the path, the same sound thins into something scarcely worth turning for.',
  ],
  market: [
    'The lane is just wide enough to gather around a stall on one side and still let a cart get past. Between the stall legs there are little hollows where the wheels throw splash. Talk nearby can be perfectly clear for a moment and disappear under one pass of an empty cart. What remains after the noise is often only the last remark.',
    'Each row of stalls is its own stretch of street. Someone at one end can see what changes hands at the next counter, while a call from three stalls away brings only the sound of a voice. Papers need something laid on their corners. The passage of a cart can lift a bare sheet as easily as a gust.',
    'Above the counters, the cloths stretched over poles hold the daylight longer than the ground does. Beneath them a chalk stroke is still clear enough to copy with the point of a finger. Work at the late stalls has moved close to the fronts of the boards, where a person can see their hands.',
    'An empty stall leaves a strip wide enough for people to stand without blocking the lane. The end of its counter still gives a good place to set down something heavy. A conversation held there is close to the carters while the little crowd around a tally is still in easy view.',
    'Some of the market boards are dark from being rubbed down with water. At the corners nearest the street they are dry already. Paper laid along those edges can be made out without leaning across anyone’s goods. The cart track beyond the stalls has a rut deep enough to keep a wheel in its place.',
    'One side of the lane can see the full face of the stone on the other. The people beneath the stall cloths have to make do with daylight off the street. There is enough of it to see a mark on paper when it is held level with the edge of the counter.',
  ],
  storehouse: [
    'The storehouse smells of the boards that have dried and of the ones that have a little river water in them yet. One shelf stands a hand’s breadth away from the wall. There is enough room to get an arm behind an awkward sack and pull it forward. Set in the right order, the sacks leave a clear way down the middle.',
    'Chalk finds every rough spot on the tally. At the marks where the board has been used for a while, the grooves are polished enough to hold dust. There are places on the floor that sound hollow under a foot. The shelves are best approached where the boards feel solid, especially with something heavy in both hands.',
    'The yard outside shows through a gap under the door. Indoors, close to the shelf, the small trade of marks and numbers is easier to hear than the river. The work looks slow from that doorway. Up by the tally each correction can save a person from lifting the same sack twice.',
    'A shelf thick enough to take a row of sacks still dips a little at the center. The marks turn away from the light where the board sags. Counting from the door would be a quick business if all anyone wanted was a number. To keep track of which sack was which, a person has to go near enough to see.',
    'There is a line across the inside of the door where the daylight stops. A sack can be turned there long enough for somebody to see the mark on it. Farther inside there are boards broad enough to rest an elbow and a tally at the same time.',
  ],
  lane: [
    'The stones of the lane have held a little warmth from the day along the foot of the houses. In the middle there are narrow patches that gleam. The turning is close enough for a person to go around it and still hear a conversation by the bakehouse, if the words were being said at full voice.',
    'The latch and the key have worn away a little of the wood at the edge of the shutter. Near ground level the boards have stayed rough. A person looking for bread would ordinarily look through the door first. With the shutter down, the edge of the paving is the nearest place to stand and see what is there.',
    'A generation of footsteps has worn the shallow step round at the corner. At dusk the bare wood is easier to make out than the face of the person on it. The lane still carries voices toward the turning. At the end of a working day the houses take back their light a window at a time.',
    'The lane bends just enough to put the higher windows out of sight before the doors disappear. A person keeping to the foot of the houses can stay clear of the wet stretch in the middle. The few remaining scraps of light lie narrow enough for the seams between stones to show.',
    'A cart has left two clean lines on the stones where its wheels rubbed the dust away. Beyond them the front step of the bakehouse lies dry under the wood above it. The set of the buildings keeps the worst of the wind out of the lane. It still finds the edge of anything that hangs loose.',
    'The dusk changes the line of a doorway before it changes the street. A dark gap that would be easy to cross at noon can look almost as solid as the wood beside it. Near the feet there is just enough light to make out where the stones give way to the step.',
  ],
};

const exchanges = {
  Alice: [
    'Alice gives an exchange the same practical attention she gives to a board with too little room on it. She allows a space for an answer before going back to what needs doing. In the gap, the ordinary work around her is audible again. A pause can be part of a conversation when there is something both people would rather keep out of the lane.',
    'Alice keeps track of the clerk’s face while the words go past. She is used to people taking a while to say what they need. There is room here to speak in a low voice and be heard. A person standing farther away would have to come a step closer to make out the words.',
  ],
  Martin: [
    'Martin gives the question his whole attention for the length of the answer. As soon as a familiar word comes up, his eyes go down briefly, the way they do when he might have to find the word on a page again. It is an officer’s habit. A person who has come for an answer can watch him decide how much he is prepared to put his name to.',
    'Martin lets the question come to its end. At the guild there is a use for hearing a man out, even when the answer will take less time than the asking. A person can tell the difference between what is said in passing and what might have to be given back word for word. Martin makes room for the latter.',
  ],
  'Market carter': [
    'The man has the wax tally to hand. A mark on it is easier to check than a remark passed from the far end of the market. It is also easier to miss if the tablet is lying away from the light. The question has brought the work of reading the marks back to the front of the stall.',
  ],
  'Guild runner': [
    'The folded copy leaves a straight edge against the uneven surface of the stall. From where you stand you can see the crease, but you would have to unfold it to read the order. The runner’s being here with a copy is something you can account for yourself. What happened at Alice’s oven is a different question.',
    'There is still room at the stall for a question before somebody goes on about their own business. The runner has carried a piece of writing. It can be read after he has gone. If you need the account of somebody who stood beside the oven, you would have to ask for that separately.',
  ],
  'Market baker': [
    'Before dawn and after dusk are close on the page of a tally. For somebody who has to bring dry wood, there is all the dark of the lane between them. An offer of space in an oven puts one part of the work within reach. It leaves Alice and anyone helping her to see about the rest.',
    'There is a little flour where the baker has been sweeping the front of the stall. The work that keeps his own bread coming out is the work that will tell him what room he can spare. For Alice the time he mentioned could be worth coming across the market in the dark to use.',
  ],
  porter: [
    'Near the tally there is room to look from the marks to the sacks without stepping into the doorway. The question can be settled here as far as his count goes. What happened to a sack before it came under his hand is somebody else’s account to give, if that is what you need to know.',
  ],
};

const reserve = {
  bakehouse: [
    'One edge of the flour board is pale where a sleeve has rubbed it all morning. The far edge is dark enough to show an impression left by a hand. A person working there has to let the other person speak before there is any chance of hearing their answer above the oven.',
    'A breath of air comes from the lane and reaches the table just above the floor. The nearer crumbs skitter a little. A heavy loaf keeps its place. There is room enough at the board for someone to stand and wait while a conversation runs past the ordinary business of buying bread.',
    'The edge of the peel shows bright where it has spent years catching against the lip of the oven. Its handle is smooth down to the place where a hand usually comes away. The space around it is tight. A person trying to pass through knows at once where the baker needs room.',
    'The patch of daylight by the doorway is wide enough for the front of a shoe and the corner of the table. Behind it, the flour on the boards stays lighter than the boards themselves. A small movement catches the eye there, even if voices from the lane are hard to make out.',
    'At the flour board the little sounds pass quickly, a sleeve on wood or the edge of the peel against brick. Past the doorway the ordinary noise of the lane is broad enough to drown those sounds together. A person who wants an answer from Alice has to stand where a loaf can still go from her hands to the table.',
    'A little of the flour on the board has settled into the old cuts. In the shallower ones it brushes away. Those at the edge are deep enough to leave a white line after the wood around them has been wiped. The table can be cleared of what was on it without looking as if nobody has worked there.',
    'The bottom of the loaf board is pale where it lies flat, and the upper face is dark in patches. At the end nearest the scales it takes very little weight to make it rock. Anyone leaning on the table needs to mind that corner, especially while Alice has both hands full.',
    'A word heard from the lane can be hard to tell apart from what somebody says at the door. The sound changes a little on the inside. The oven takes up most of the quiet there, leaving room near the scales for people who have stopped to listen to an answer.',
    'At the place where the brickwork meets the floor there is a thin line of pale ash. The heat is easier to feel on the back of a hand than against a coat. It comes only a little way past the oven. The lane is close enough that someone at the doorway would feel the difference through the same sleeve.',
    'The scales are at a height to see with the bread in your hands. A customer need not put a loaf down to look at an empty pan. The ledger takes up a different part of the board. It draws a person close enough to make out the marks before they can ask what the marks are for.',
    'By the wall the board is dry enough to take flour without taking a print of what last lay on it. Toward the oven the warmth has made the grain stand out. A folded cloth would serve for a hand there. It would not help anyone see across the whole table when a page is turned away.',
  ],
  guild: [
    'There is a long space down one side of the table where a bound book can be turned without brushing an elbow. The benches give people room to wait at a distance. To hear what goes into a record, a person has to come as close as the person putting the words down.',
    'Light settles at the edge of the seal. It does less to show the people standing over it than to make a page easy to read. Beyond the table there is only as much room for another question as the people waiting are willing to leave between themselves and whoever has the book.',
    'A corner of the bench has been rounded by people sitting there in heavy coats. Its ends are rougher where no one rests a hand. Even a quiet voice travels in the open space between the bench and the table. A question put there can be heard by everyone who is close enough to answer.',
    'The edge of a page can vanish against the pale grain before the written part does. The bench gives one view of the table and the place by the book gives another. From the farther side you can see who is attending without being able to read a single word they have before them.',
  ],
  landing: [
    'The stones nearest the water are darker where a little wet has stayed around their edges. Above them the grain in the boards is open and dry. A piece of paper would curl if it were left at the edge. To keep it flat here takes a hand near each end.',
    'At the top of the steps the wind has a clean run between the houses. Down under the bank, it reaches the boards in patches. The quiet places do not lie next to one another. A person standing close beside you can speak clearly while a voice from the lane goes past in pieces.',
    'The landing ends where the paved part of the street gives way to the boards. Someone carrying paper can find space out of the way there. The sound of the river is still close enough to hide a voice. It would be difficult to make out words from much farther up the path.',
    'The boards run far enough along the water to leave a gap between a conversation and the edge, if both people stand in the right place. A few threads of wet straw have stuck in a joint. Farther up, where the wood stays dry, there is room to get out of the wind.',
    'The path narrows where it meets the boards. When a load comes through, a person with nothing to carry has to find a place to stand until it is past. A low voice carries well enough from the dry side. What anyone farther along the street might hear is mostly the knocking of the water against the edge.',
    'There is enough room by the wall for the river to be heard even when the water itself is out of sight. A spoken word lands in the gaps between those sounds. Words put on paper can keep through a much louder interval, if the paper stays dry. There is no level table down here to stop its corners lifting.',
  ],
  market: [
    'There is room at the end of the stall for a paper to lie between the goods and the public part of the counter. Near the middle, anybody trying to read has to lean across somebody else’s work. By the end, whoever is speaking can leave enough space for another person to come up beside them.',
    'From under the cloth over a stall the street looks lighter than the inside of the market. A person can follow what somebody says there by looking at their face. A mark in wax takes a different angle. The smaller the mark, the more it matters whether the table catches the light.',
    'The front of the counter is more worn where people have put their hands to steady themselves on the paving. Past the corner, where no one is meant to stand, the grain remains rough. Two people can talk there while the rest of the stall goes on being used for what it was built for.',
    'The street running past the tables has light enough left to see a hand against the cloth, though not enough to see across the whole row. A voice at one table need not carry to the next. Coming a little closer is the simplest way to hear the end of a sentence.',
    'The wheels have left a raised strip between the ruts. A person crossing it in a long coat has to pull the hem clear before approaching the stall. At the edge of the market there are spaces too narrow to drive through. Those are the places where somebody can stop long enough for an answer.',
    'A bare place between folds of the stall cloth lets the light fall across the counter. The rest of the table is in shadow. A mark is sometimes clearer when the light comes along it, and a line of ink is easier to read with the paper held steady. There is space to do either at this end of the stall.',
    'The street is wide at the place where the stalls stop and narrow halfway down the next row. A raised voice goes a long way through that opening, even when the speaker is already gone from sight. To ask a quiet question takes a place out of the way of people passing in both directions.',
    'Along the length of the counter there are places where a board fits tight and places where the join shows daylight. The open places catch the edge of anything laid down too quickly. At the solid end of the counter somebody can put their work down and still leave room beside it for a paper.',
    'Beyond the stalls the last light falls across the paving at an angle. Near the walls it has already gone. A person coming back when the street is dark would have to mind the ruts by feel. The distance is short in the daylight, before anything has to be carried along it.',
    'The ends of the stall cloths have been rolled as far as the front poles. There is a view out along the row without much light left behind the counter. Anything that needs reading has to be brought forward. The place for a close question is on the other side of that line, where people can still hear each other.',
  ],
  storehouse: [
    'Under the shelves the light reaches only as far as the front legs of the boards. From the entrance the darker gaps could all belong to the same sack. Closer in, each mouth of cloth has its own shape. There is space to turn sideways and see the mark without having to shift the rest.',
    'The boards beside the tally have a light dusting of chalk. Farther away, where the work is mostly carrying, the dust is darker. The boundary runs across the floor without much to distinguish it. One piece of work needs a clear path to a shelf. The other needs a place with enough light to compare marks.',
    'The end of a shelf is wide enough for a hand without being wide enough to leave a sack on it. A person counting has to keep the mark in sight when they look away from the tally. There is just enough room beneath the beam to stand clear of somebody doing that work.',
    'Light from the yard reaches one side of the doorway and breaks off at the inside boards. The darker side leaves room for sacks without closing the path between the shelves. One person can stand beside the tally and talk while another can still make their way from the door into the room.',
    'The old barrel at the door leaves a clear stretch along one wall. The nearest shelf is too close for anybody to swing a full sack around alone. Marks can be compared in the space left between. It is possible to make out what the porter is pointing to without getting in the way of somebody carrying.',
    'On the nearest sack the weave is rougher at the seam. In the light that comes from the doorway a mark sits clear of it. The chalk tally only needs a sign the porter can look up after his back is turned. It takes a little more time to get from the chalk to the right shelf.',
    'At the bottom of the shelf nearest the door, there is a clear place just high enough to keep a sack above the floor. From that height a person has to turn a mark outward if it is to be read. A sack can take up an entire space even when its mark hardly takes up any room.',
    'The barrel stands far enough off the wall to leave the door free to move. The light through the gap makes it easy to see where chalk has caught in the rough grain. The rest of the count belongs farther inside. A person at the door can hear about a mark without seeing which sack it belongs to.',
  ],
  lane: [
    'The houses leave a narrow strip of open sky over the lane. The last of its light rests on the step and hardly reaches the paving against the walls. A person coming back from the corner has enough light to see the way to a familiar door without being able to make out much farther along.',
    'At the foot of the bakehouse wall there is still a place to stand out of the way of the lane. The step holds a little more light than the top of the doorway. Someone about to leave can still be heard in that space before the bend cuts off the sound of a voice.',
    'Past the turning the air feels cooler. Here by the wall, the lane is narrow enough to carry a sound long after there is anybody in view to make it. The few pale faces of the stones show most clearly where a person ordinarily puts a foot on the way to the door.',
    'The foot of the wall takes the last light at a slant. It is enough to show the uneven surface without showing where the lane runs after the houses turn. A person going that way has only to wait until their eyes have had time to make out the first few stones around the corner.',
  ],
};

const authoredDetails = new Set([developments, exchanges, settings, reserve].flatMap(group => Object.values(group).flat()));

function detailId(paragraph) {
  return createHash('sha256').update(paragraph).digest('hex').slice(0, 16);
}

export function rememberSceneDetails(passages) {
  const recentDetails = [];
  const detailUses = {};
  for (const passage of passages) {
    const details = passage.paragraphs.filter(paragraph => authoredDetails.has(paragraph));
    if (details.length) recentDetails.push(details);
    for (const paragraph of details) {
      const id = detailId(paragraph);
      detailUses[id] = (detailUses[id] ?? 0) + 1;
    }
  }
  return { recentDetails: recentDetails.slice(-2), detailUses };
}

function rotated(items, offset) {
  const start = offset % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

function wordCount(paragraph) {
  return paragraph.split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}

function settingFor(passage) {
  if (/Storehouse/u.test(passage.location)) return 'storehouse';
  if (/Guild room/u.test(passage.location)) return 'guild';
  if (/landing/u.test(passage.location)) return 'landing';
  if (/market/u.test(passage.location)) return 'market';
  return /dusk/iu.test(passage.time) ? 'lane' : 'bakehouse';
}

function actionTerms(text) {
  const words = text.toLowerCase().match(/[\p{L}]{4,}/gu) ?? [];
  return new Set(words.filter(word => !commonWords.has(word)).map(word => word.replace(/([^s])s$/u, '$1')));
}

function developmentsFor(passage) {
  return (developments[passage.heading] ?? []).filter((_, index) => index !== inactiveDevelopments.get(passage.heading));
}

function exchangesFor(passage) {
  if (!passage.heading.startsWith('A word with ')) return [];
  const speaker = passage.heading.slice('A word with '.length);
  return exchanges[speaker] ?? (settingFor(passage) === 'storehouse' ? exchanges.porter : []);
}

function closesOnDecision(passage) {
  return passage.paragraphs.length > 1
    && (decisionHeadings.has(passage.heading) || passage.heading.startsWith('A word with '));
}

export function assembleScene(passages, history = [], recentDetails = [], detailUses = {}, { topics: direction = [], beat: directedBeat } = {}) {
  const moments = passages.map(passage => ({ passage, before: [], after: [] }));
  const seen = new Set();
  const usedGroups = new Set();
  const familiar = new Set(recentDetails.flat());
  const usage = { ...detailUses };
  const coveredTopics = new Map();
  const closingDetails = new Map();
  for (const paragraph of familiar) usage[detailId(paragraph)] ??= 1;
  let words = passages.flatMap(passage => passage.paragraphs).reduce((total, paragraph) => total + wordCount(paragraph), 0);
  const target = Math.max(minimum, Math.min(ceiling, pacingDirection.targetWords));

  function add({ collection, paragraph, id, group, passage, topics, priority }, limit) {
    if (seen.has(paragraph) || familiar.has(paragraph) || usedGroups.has(group) || words >= limit) return;
    const length = wordCount(paragraph);
    if (words + length > ceiling) return;
    collection.push(paragraph);
    seen.add(paragraph);
    if (group) usedGroups.add(group);
    usage[id] = (usage[id] ?? 0) + 1;
    if (priority >= 6 && !closingDetails.has(passage)) closingDetails.set(passage, paragraph);
    const covered = coveredTopics.get(passage) ?? new Set();
    for (const topic of topics) covered.add(topic);
    coveredTopics.set(passage, covered);
    words += length;
  }

  const preferred = [];
  const reserves = [];
  function candidate(collection, paragraph, passage, priority, group) {
    const input = actionTerms(passage.playerText ?? '');
    const beat = actionTerms([passage.heading, ...passage.paragraphs].join(' '));
    const words = actionTerms(paragraph);
    const topics = [...words].filter(term => input.has(term) || beat.has(term));
    const overlap = topics.reduce((score, term) => score + (input.has(term) ? 2 : 1), 0);
    const avenueOverlap = passage === passages.at(-1) ? direction.filter(term => words.has(term)).length : 0;
    return { collection, paragraph, id: detailId(paragraph), group, passage, topics, priority,
      score: priority + pacingDirection.relevanceWeight * Math.min(overlap, 5) + Math.min(avenueOverlap, 3) * 2 };
  }
  function freshScore(detail) {
    const covered = coveredTopics.get(detail.passage);
    const reuses = covered ? detail.topics.filter(topic => covered.has(topic)).length : 0;
    return detail.score - reuses * (pacingDirection.topicRepetitionPenalty ?? 0);
  }

  function addFresh(candidates) {
    const pending = candidates.filter(detail => !usage[detail.id]);
    while (pending.length && words < target) {
      pending.sort((a, b) => freshScore(b) - freshScore(a));
      add(pending.shift(), target);
    }
  }

  const playable = moments.filter(({ passage }) => !['A moment to decide', 'The story closes'].includes(passage.heading));
  for (const { passage, after } of playable) {
    const group = routineExplanations.has(passage.heading) ? passage : undefined;
    for (const paragraph of developmentsFor(passage)) preferred.push(candidate(after, paragraph, passage, 10, group));
  }
  for (const { passage, after } of playable) {
    const lines = exchangesFor(passage);
    if (!lines.length) continue;
    const offset = history.filter(moment => moment.heading === passage.heading).length;
    for (const paragraph of rotated(lines, offset)) preferred.push(candidate(after, paragraph, passage, 6, passage));
  }
  for (const { passage, before, after } of playable) {
    const setting = settingFor(passage);
    const offset = history.filter(moment => settingFor(moment) === setting).length;
    const conversation = passage.heading.startsWith('A word with ');
    const playerTurn = history.length > 0 || Boolean(passage.playerText);
    for (const [index, paragraph] of rotated(settings[setting], offset).entries()) {
      const leadWithDetail = !conversation && (!pacingDirection.leadWithResolution || !playerTurn) && index === 0;
      preferred.push(candidate(leadWithDetail ? before : after, paragraph, passage, 0));
    }
    for (const paragraph of rotated(reserve[setting], offset)) reserves.push(candidate(after, paragraph, passage, 0));
  }
  const byRelevance = (a, b) => b.score - a.score;
  addFresh(preferred);
  if (words < minimum) addFresh(reserves);
  // Revisit a local detail only after its fresh alternatives can no longer fill the turn.
  if (words < minimum) {
    const leastUsed = [...preferred, ...reserves].sort((a, b) => (usage[a.id] ?? 0) - (usage[b.id] ?? 0) || byRelevance(a, b));
    for (const detail of leastUsed) add(detail, minimum);
  }
  return {
    paragraphs: moments.flatMap(({ passage, before, after }, index) => {
      const isFinal = index === moments.length - 1;
      const closes = isFinal && ((pacingDirection.closeOnDecision && closesOnDecision(passage))
        || (directedBeat && passage.paragraphs.at(-1) === directedBeat));
      if (!closes) {
        const focused = pacingDirection.closeOnFocus && isFinal && closingDetails.get(passage);
        if (focused) return [...before, ...passage.paragraphs, ...after.filter(paragraph => paragraph !== focused), focused];
        return [...before, ...passage.paragraphs, ...after];
      }
      return [...before, ...passage.paragraphs.slice(0, -1), ...after, passage.paragraphs.at(-1)];
    }),
    recentDetails: seen.size ? [...recentDetails.slice(-1), [...seen]] : recentDetails,
    detailUses: usage,
  };
}
