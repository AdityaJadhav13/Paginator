// The fictional stories of a test edition (POST …/onboarding/test-edition): enough text of varied lengths, and a few
// briefs, for "Make a test layout" to fill a 4-page edition in the paper's own design. Every town, person and event here
// is made up (Nilgaon, Kesarwadi, Sundarpur …), so a test page can never be taken for news. Desk text: paragraphs
// separated by empty lines, no "#" subheadings.

export type SampleStory = { headline: string; kicker: string; byline: string; body: string; priority: 1 | 2 | 3 | 4 };

const story = (
  priority: SampleStory["priority"],
  headline: string,
  paragraphs: string[],
  kicker = "",
  byline = "",
): SampleStory => ({ headline, kicker, byline, body: paragraphs.join("\n\n"), priority });

export const SAMPLE_STORIES_EN: readonly SampleStory[] = [
  story(
    1,
    "Nilgaon opens its new river bridge after three monsoons",
    [
      "NILGAON — The new bridge over the Kesar river opened to traffic on Monday morning, ending a three-year wait for the farmers and traders of the eastern villages, who had crossed by ferry since the old causeway was washed away.",
      "The two-lane bridge is 240 metres long and carries a footpath on each side. The district works office said it was built to stand a flood higher than any recorded on the river.",
      'Shopkeepers in the weekly market said the first effect was easy to see. "The vegetable carts were here by seven," said one fruit seller. "With the ferry we waited until ten."',
      "Buses from Kesarwadi will now run every hour instead of twice a day. The transport office said it would review the timetable after the festival season.",
      "The old ferry landing will be kept as a small park, the town council decided last week, with benches and a board telling the story of the crossing.",
    ],
    "Infrastructure",
    "Staff Reporter",
  ),
  story(
    1,
    "Sundarpur school wins the district science fair with a rain gauge made of bottles",
    [
      "A team of four Class 9 students from the Sundarpur municipal school won first prize at the district science fair for a rain gauge built from plastic bottles and a mobile phone.",
      "The gauge records every millimetre of rain and sends the reading to the school's notice board screen. The students placed six of them across the village during the last monsoon.",
      "Their teacher said the idea came from the students' own question: why the rain in one field was so different from the next.",
      "The team will present the project at the state fair next month.",
    ],
    "Education",
  ),
  story(2, "Water supply to be cut in the old town on Thursday", [
    "The Nilgaon water works will shut the main pipeline from 9 am to 5 pm on Thursday to replace a valve. The old town and the station area will have no supply during those hours. Tankers will be posted near the temple square.",
  ]),
  story(
    2,
    "Kesarwadi farmers try a shared cold store for onions",
    [
      "Thirty-two onion growers in Kesarwadi have pooled their savings to rent a cold store for the season, hoping to sell when prices recover rather than at harvest.",
      "The group's secretary said each member pays by the sack. A ledger at the gate records what goes in and who takes it out.",
      "Agricultural officers said a shared store can cut losses from rot by half, if the onions are dried well before they go in.",
    ],
    "Agriculture",
  ),
  story(2, "Library extends its hours for exam season", [
    "The Sundarpur public library will stay open until 9 pm on weekdays until the end of March, so that students preparing for board examinations have a quiet place to study. Entry is free with a school identity card.",
  ]),
  story(2, "Night bus service between Nilgaon and the district town to begin", [
    "A night bus will run between Nilgaon and the district town from next week, leaving at 10 pm and returning at 5 am.",
    "Hospital staff and factory workers on the late shift had asked for the service for two years. The transport office said the route would be tried for three months before a decision on keeping it.",
  ]),
  story(3, "Women's self-help group opens a tiffin service", [
    "Eleven members of the Saptarang self-help group in Kesarwadi have started a lunch delivery service for offices in the market area.",
    "They cook in a rented kitchen behind the cooperative bank and deliver by bicycle. On the first day they sent out 46 tiffins; by the end of the week, 120.",
    "The group plans to add a second kitchen if orders keep growing.",
  ]),
  story(3, "Stray cattle to be moved to the new shelter", [
    "The town council has asked owners to collect their cattle from the roads by Sunday. Animals still found on the main road after that will be taken to the new shelter on the Sundarpur road.",
  ]),
  story(
    3,
    "Kabaddi: Nilgaon Lions reach the district final",
    [
      "The Nilgaon Lions beat Kesarwadi Sporting 34–29 in a tense semi-final on Saturday evening, watched by a crowd that filled the school ground.",
      "The Lions trailed by five points at half-time but their raiders turned the game in the last ten minutes. The final will be played next Sunday against the Sundarpur Club.",
    ],
    "Sport",
  ),
  story(3, "Old post office building to become a museum of the town", [
    "The stone post office building on Station Road, empty since the new office opened in 2019, will become a small museum of the town's history.",
    "Residents have been asked to lend old photographs, letters and tools. The council's heritage committee will choose what goes on display and return everything after the first year.",
    "The committee hopes to open the museum before the town's founding day in December.",
  ]),
  story(4, "Tree planting drive on Sunday", [
    "Volunteers will plant 500 saplings along the canal road on Sunday from 7 am. Gloves and tools will be given at the ward office.",
  ]),
  story(4, "Free eye camp at the primary health centre", [
    "The Kesarwadi primary health centre will hold a free eye check-up camp on Saturday. Spectacles will be given at cost to those who need them.",
  ]),
  story(
    4,
    "Letters: the market needs more shade",
    [
      "Every summer the vegetable sellers in the Nilgaon market sit under torn sheets of plastic. A row of trees, or a simple roof, would help them and their customers. The council has the space beside the bus stand; it only needs the will.",
    ],
    "Opinion",
  ),
  story(4, "Weather: clear skies, warm afternoons", [
    "Clear skies are expected over the district for the rest of the week, with afternoon temperatures near 34 °C and cool mornings. No rain is forecast before the weekend.",
  ]),
];

export const SAMPLE_STORIES_MR: readonly SampleStory[] = [
  story(
    1,
    "तीन पावसाळ्यांनंतर नीलगावचा नवा नदीपूल वाहतुकीसाठी खुला",
    [
      "नीलगाव — केसर नदीवरील नवा पूल सोमवारी सकाळी वाहतुकीसाठी खुला झाला. जुना बंधारा वाहून गेल्यापासून पूर्वेकडील गावांतील शेतकरी आणि व्यापारी होडीने ये-जा करत होते; त्यांची तीन वर्षांची प्रतीक्षा आता संपली.",
      "दोन पदरी पूल २४० मीटर लांब असून दोन्ही बाजूंना पदपथ आहे. नदीला आजवर आलेल्या कोणत्याही पुरापेक्षा मोठा पूर सोसेल अशा रीतीने तो बांधल्याचे जिल्हा बांधकाम कार्यालयाने सांगितले.",
      'आठवडी बाजारातील दुकानदारांना पहिल्याच दिवशी फरक जाणवला. "भाजीच्या गाड्या सातलाच आल्या," एका फळविक्रेत्याने सांगितले. "होडीने यायचे तेव्हा दहा वाजायचे."',
      "केसरवाडीहून येणाऱ्या बस आता दिवसातून दोनदा नव्हे तर दर तासाला धावतील. सणासुदीनंतर वेळापत्रकाचा आढावा घेतला जाईल, असे परिवहन कार्यालयाने सांगितले.",
      "जुन्या होडी धक्क्याच्या जागी बाके आणि नदी ओलांडण्याची कहाणी सांगणारा फलक असलेले छोटे उद्यान केले जाईल, असा निर्णय नगर परिषदेने गेल्या आठवड्यात घेतला.",
    ],
    "पायाभूत सुविधा",
    "प्रतिनिधी",
  ),
  story(
    1,
    "बाटल्यांपासून बनवलेल्या पर्जन्यमापकाने सुंदरपूर शाळेला जिल्हा विज्ञान प्रदर्शनात पहिले बक्षीस",
    [
      "सुंदरपूर नगरपालिका शाळेतील नववीच्या चार विद्यार्थ्यांनी प्लास्टिकच्या बाटल्या आणि मोबाइल फोनपासून बनवलेल्या पर्जन्यमापकाला जिल्हा विज्ञान प्रदर्शनात पहिले बक्षीस मिळाले.",
      "हा मापक प्रत्येक मिलिमीटर पावसाची नोंद करतो आणि ती शाळेच्या सूचना फलकावरील पडद्यावर पाठवतो. गेल्या पावसाळ्यात विद्यार्थ्यांनी गावात असे सहा मापक बसवले होते.",
      "एका शेतातील पाऊस शेजारच्या शेतापेक्षा इतका वेगळा का, या विद्यार्थ्यांच्याच प्रश्नातून ही कल्पना सुचली, असे त्यांच्या शिक्षकांनी सांगितले.",
      "पुढील महिन्यात हा प्रकल्प राज्य प्रदर्शनात मांडला जाईल.",
    ],
    "शिक्षण",
  ),
  story(2, "गुरुवारी जुन्या गावात पाणीपुरवठा बंद", [
    "झडप बदलण्यासाठी नीलगाव जलकेंद्र गुरुवारी सकाळी ९ ते सायंकाळी ५ या वेळेत मुख्य जलवाहिनी बंद ठेवणार आहे. या काळात जुने गाव आणि स्थानक परिसरात पाणी येणार नाही. मंदिर चौकाजवळ टँकर ठेवले जातील.",
  ]),
  story(
    2,
    "केसरवाडीतील शेतकऱ्यांचे कांद्यासाठी सामायिक शीतगृह",
    [
      "केसरवाडीतील बत्तीस कांदा उत्पादकांनी आपली बचत एकत्र करून या हंगामासाठी शीतगृह भाड्याने घेतले आहे. काढणीच्या वेळी नव्हे तर भाव सुधारल्यावर कांदा विकण्याची त्यांची योजना आहे.",
      "प्रत्येक सभासद पोत्यामागे भाडे देतो. काय आत गेले आणि कोणी बाहेर नेले याची नोंद प्रवेशद्वारावरील वहीत होते, असे गटाच्या सचिवांनी सांगितले.",
      "कांदा आत ठेवण्यापूर्वी नीट वाळवला तर सामायिक शीतगृहामुळे सडण्याचे नुकसान निम्म्यावर येऊ शकते, असे कृषी अधिकाऱ्यांनी सांगितले.",
    ],
    "शेती",
  ),
  story(2, "परीक्षेच्या काळात ग्रंथालय उशिरापर्यंत खुले", [
    "मंडळाच्या परीक्षांची तयारी करणाऱ्या विद्यार्थ्यांना शांत जागा मिळावी म्हणून सुंदरपूर सार्वजनिक ग्रंथालय मार्चअखेरपर्यंत आठवड्याच्या दिवशी रात्री ९ पर्यंत खुले राहील. शाळेचे ओळखपत्र दाखवल्यास प्रवेश विनामूल्य आहे.",
  ]),
  story(2, "नीलगाव ते जिल्ह्याचे ठिकाण रात्रीची बससेवा सुरू होणार", [
    "पुढील आठवड्यापासून नीलगाव आणि जिल्ह्याच्या ठिकाणादरम्यान रात्रीची बस धावेल. ती रात्री १० वाजता सुटेल आणि पहाटे ५ वाजता परत येईल.",
    "रुग्णालयातील कर्मचारी आणि रात्रपाळीचे कामगार दोन वर्षांपासून या सेवेची मागणी करत होते. ही सेवा कायम ठेवायची की नाही हे ठरवण्यापूर्वी तीन महिने ती चालवून पाहिली जाईल, असे परिवहन कार्यालयाने सांगितले.",
  ]),
  story(3, "महिला बचत गटाची डबा सेवा सुरू", [
    "केसरवाडीतील सप्तरंग बचत गटाच्या अकरा सदस्यांनी बाजार परिसरातील कार्यालयांसाठी दुपारच्या जेवणाची डबा सेवा सुरू केली आहे.",
    "सहकारी बँकेच्या मागे भाड्याच्या स्वयंपाकघरात त्या स्वयंपाक करतात आणि सायकलवरून डबे पोहोचवतात. पहिल्या दिवशी ४६ डबे गेले; आठवड्याअखेरीस १२०.",
    "मागणी अशीच वाढत राहिली तर दुसरे स्वयंपाकघर सुरू करण्याचा गटाचा विचार आहे.",
  ]),
  story(3, "मोकाट जनावरे नव्या गोशाळेत हलवणार", [
    "रविवारपर्यंत आपली जनावरे रस्त्यावरून घेऊन जावीत, असे आवाहन नगर परिषदेने मालकांना केले आहे. त्यानंतर मुख्य रस्त्यावर आढळणारी जनावरे सुंदरपूर रस्त्यावरील नव्या गोशाळेत नेली जातील.",
  ]),
  story(
    3,
    "कबड्डी: नीलगाव लायन्स जिल्हा अंतिम फेरीत",
    [
      "शनिवारी सायंकाळी शाळेच्या मैदानावर खचाखच भरलेल्या प्रेक्षकांसमोर झालेल्या उपांत्य सामन्यात नीलगाव लायन्सने केसरवाडी स्पोर्टिंगचा ३४–२९ असा पराभव केला.",
      "मध्यंतराला लायन्स पाच गुणांनी मागे होते, पण शेवटच्या दहा मिनिटांत त्यांच्या चढाईपटूंनी सामना फिरवला. पुढील रविवारी अंतिम सामना सुंदरपूर क्लबविरुद्ध होईल.",
    ],
    "क्रीडा",
  ),
  story(3, "जुन्या टपाल कार्यालयात गावाचे संग्रहालय", [
    "२०१९ मध्ये नवे कार्यालय सुरू झाल्यापासून रिकामी असलेली स्टेशन रस्त्यावरील दगडी टपाल कार्यालयाची इमारत आता गावाच्या इतिहासाचे छोटे संग्रहालय होणार आहे.",
    "रहिवाशांनी जुनी छायाचित्रे, पत्रे आणि अवजारे उसनी द्यावीत, असे आवाहन करण्यात आले आहे. काय मांडायचे ते परिषदेची वारसा समिती ठरवेल आणि पहिल्या वर्षानंतर सर्व वस्तू परत करेल.",
    "डिसेंबरमधील गावाच्या स्थापना दिनापूर्वी संग्रहालय सुरू करण्याची समितीची इच्छा आहे.",
  ]),
  story(4, "रविवारी वृक्षारोपण मोहीम", [
    "रविवारी सकाळी ७ वाजल्यापासून स्वयंसेवक कालवा रस्त्यालगत ५०० रोपे लावतील. हातमोजे आणि अवजारे प्रभाग कार्यालयात मिळतील.",
  ]),
  story(4, "प्राथमिक आरोग्य केंद्रात मोफत नेत्र शिबिर", [
    "केसरवाडी प्राथमिक आरोग्य केंद्रात शनिवारी मोफत नेत्र तपासणी शिबिर होईल. गरजूंना चष्मे किमतीत दिले जातील.",
  ]),
  story(
    4,
    "वाचकांची पत्रे: बाजाराला सावली हवी",
    [
      "दर उन्हाळ्यात नीलगाव बाजारातील भाजीविक्रेते फाटक्या प्लास्टिकखाली बसतात. झाडांची एक रांग किंवा साधे छप्पर त्यांना आणि ग्राहकांना दिलासा देईल. बसस्थानकाशेजारी परिषदेकडे जागा आहे; फक्त इच्छाशक्ती हवी.",
    ],
    "मत",
  ),
  story(4, "हवामान: निरभ्र आकाश, उबदार दुपार", [
    "आठवड्याच्या उर्वरित दिवसांत जिल्ह्यावर निरभ्र आकाश राहील. दुपारचे तापमान सुमारे ३४ °से आणि सकाळ गार असेल. शनिवार-रविवारपूर्वी पावसाचा अंदाज नाही.",
  ]),
];

/** The stories in the publication's primary language: Marathi for mr, English otherwise. */
const MAX_TEST_STORIES = 60;
/** half as many words again as the plan needs (the readiness advice is 15–20 % extra; short samples need more), so the
 * last page is not left short */
const HEADROOM = 1.5;
const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** The test edition's stories: the samples in the paper's language, taken again in turn (the same fictional text) until
 * there are as many stories and words as the profile's 4-page plan needs (a paper's needs come from its own pages), at
 * most MAX_TEST_STORIES; a repeat is never the lead, and runs longer. */
export function sampleStoriesFor(
  language: string,
  needs: { stories: number; briefs: number; words: number } | null = null,
): SampleStory[] {
  const samples = language === "mr" ? SAMPLE_STORIES_MR : SAMPLE_STORIES_EN;
  const out: SampleStory[] = [];
  let words = 0;
  const wanted = needs ? needs.stories + needs.briefs : samples.length;
  const wantedWords = (needs?.words ?? 0) * HEADROOM;
  while (out.length < MAX_TEST_STORIES && (out.length < samples.length || out.length < wanted || words < wantedWords)) {
    const at = (k: number) => samples[k % samples.length] as SampleStory;
    const s = at(out.length);
    // a repeat runs longer (its text, then the next two samples' paragraphs): a page needs fewer of them
    const next =
      out.length < samples.length
        ? s
        : {
            ...s,
            priority: s.priority === 1 ? 2 : s.priority,
            body: [s, at(out.length + 1), at(out.length + 2)].map((x) => x.body).join("\n\n"),
          };
    out.push(next);
    words += wordsOf(next.body);
  }
  return out;
}
