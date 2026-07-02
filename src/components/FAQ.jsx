import React, { useState } from 'react';

const FAQ = ({ lang, translations, courseId = null }) => {
  const t = translations[lang];
  const [openIndex, setOpenIndex] = useState(null);

  const generalFaqs = {
    ht: [
      { q: "Kouman m ap jwenn lyen Google Meet la?", a: "Yon fwa ou fin peye enskripsyon an, n ap voye yon imel konfimasyon ba ou. Lyen Google Meet la ap disponib nan group WhatsApp klas la epi n ap voye l ba ou 24h anvan chak sesyon kòmanse." },
      { q: "Mwen pa gen laptop, èske m ka swiv kou yo?", a: "Wi! Se pou sa nou gen kou Power Android (Termux) an espesyalman. Menm lòt kou yo tankou Python ak Web Dev ka fèt sou telefòn si w itilize zouti nou rekòmande yo." },
      { q: "Ki jou ak ki lè kou yo ap fèt?", a: "Kou yo ap fèt pandan wikenn (Samdi ak Dimanch) nan apremidi pou pèmèt tout moun ki travay oswa ki gen lòt okipasyon patisipe." },
      { q: "Èske m ap resevwa yon sètifika?", a: "Wi, tout elèv ki fin swiv 80% nan kou a epi ki reyalize pwojè final la ap resevwa yon sètifika dijital pwofesyonèl." },
      { q: "Si m rate yon sesyon, kisa k ap rive?", a: "Pa gen pwoblèm! Tout sesyon Live yo anrejistre an bon kalite. Elèv yo ap gen aksè ak yon platfòm pou revwa yo pandan 6 mwa." },
      { q: "Kouman mwen ka enskri nan yon kou?", a: "Kontakte yon admin nan espas jesyon kou a (Course Manager) pou w jwenn plis enfòmasyon sou enskripsyon. Nou p ap travay ak fòm peman sou entènèt kounye a." },
      { q: "Èske gen sipò apre kou a fini?", a: "Wi, chak elèv ap rete nan yon kominote ansyen elèv pou kontinye poze kesyon ak pataje pwojè." }
    ],
    en: [
      { q: "How will I get the Google Meet link?", a: "Once you've paid the registration fee, we will send you a confirmation email. The Google Meet link will be available in the class WhatsApp group and we will send it to you 24h before each session starts." },
      { q: "I don't have a laptop, can I follow the courses?", a: "Yes! That's why we have the Power Android (Termux) course specifically. Even other courses like Python and Web Dev can be done on a phone if you use the tools we recommend." },
      { q: "Which days and at what time will the courses be held?", a: "Courses will be held during weekends (Saturday and Sunday) in the afternoon to allow everyone who works or has other occupations to participate." },
      { q: "Will I receive a certificate?", a: "Yes, all students who have followed 80% of the course and completed the final project will receive a professional digital certificate." },
      { q: "If I miss a session, what happens?", a: "No problem! All Live sessions are recorded in high quality. Students will have access to a platform to review them for 6 months." },
      { q: "How do I enroll in a course?", a: "Contact an admin in the Course Manager space to learn about enrollment. We are not processing online payments right now." },
      { q: "Is there support after the course ends?", a: "Yes, each student will remain in a community of former students to continue asking questions and sharing projects." }
    ],
    es: [
      { q: "¿Cómo recibiré el enlace de Google Meet?", a: "Una vez que hayas pagado la tarifa de inscripción, te enviaremos un correo electrónico de confirmación. El enlace de Google Meet estará disponible en el grupo de WhatsApp de la clase y te lo enviaremos 24 horas antes de que comience cada sesión." },
      { q: "No tengo laptop, ¿puedo seguir los cursos?", a: "¡Sí! Por eso tenemos el curso Power Android (Termux) específicamente. Incluso otros cursos como Python y Web Dev se pueden hacer en un teléfono si usas las herramientas que recomendamos." },
      { q: "¿Qué días y a qué hora se impartirán los cursos?", a: "Los cursos se impartirán durante los fines de semana (sábado y domingo) por la tarde para permitir que todos los que trabajan o tienen otras ocupaciones participen." },
      { q: "¿Recibiré un certificado?", a: "Sí, todos los estudiantes que hayan seguido el 80% del curso y completado el proyecto final recibirán un certificado digital profesional." }
    ],
    fr: [
      { q: "Comment vais-je recevoir le lien Google Meet ?", a: "Une fois que vous aurez payé les frais d'inscription, nous vous enverrons un e-mail de confirmation. Le lien Google Meet sera disponible dans le groupe WhatsApp de la classe et nous vous l'enverrons 24 heures avant le début de chaque session." },
      { q: "Je n'ai pas d'ordinateur portable, puis-je suivre les cours ?", a: "Oui ! C'est pourquoi nous avons le cours Power Android (Termux) spécifiquement. Même d'autres cours comme Python et Web Dev peuvent être suivis sur un téléphone si vous utilisez les outils que nous recommandons." },
      { q: "Quels jours et à quelle heure les cours auront-ils lieu ?", a: "Les cours auront lieu le week-end (samedi et dimanche) l'après-midi pour permettre à tous ceux qui travaillent ou ont d'autres occupations de participer." },
      { q: "Vais-je recevoir un certificat ?", a: "Oui, tous les étudiants ayant suivi 80 % du cours et réalisé le projet final recevront un certificat numérique professionnel." }
    ]
  };

  const allFaqs = generalFaqs[lang] || generalFaqs['ht'];
  const titleSuffix = courseId ? t.faq_course_suffix : '';

  const toggleFaq = (index) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="faq-section" style={{ marginTop: '50px' }}>
      <h3 style={{ textAlign: 'center', color: 'var(--pink-primary)', marginBottom: '20px' }}>
        {t.faq_title} {titleSuffix}
      </h3>
      {allFaqs.map((faq, index) => (
        <div key={index} className="faq-item">
          <div 
            className="faq-question" 
            onClick={() => toggleFaq(index)}
            style={{
              padding: '15px',
              background: 'var(--pink-light)',
              cursor: 'pointer',
              fontWeight: 'bold',
              display: 'flex',
              justifyContent: 'space-between',
              color: 'var(--text-main)',
              borderBottom: openIndex === index ? 'none' : '1px solid rgba(216, 27, 96, 0.1)'
            }}
          >
            {faq.q} 
            <i className={`fas ${openIndex === index ? 'fa-minus' : 'fa-plus'}`}></i>
          </div>
          {openIndex === index && (
            <div className="faq-answer" style={{
              padding: '15px',
              borderTop: '1px solid var(--pink-light)',
              color: 'var(--text-main)',
              background: 'var(--card-bg)'
            }}>
              {faq.a}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default FAQ;
