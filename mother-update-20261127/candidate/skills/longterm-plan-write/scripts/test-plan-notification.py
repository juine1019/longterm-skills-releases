"""Synthetic, offline regression fixture; contains no real recipient or institution data."""
import copy
import importlib.util
from pathlib import Path
import unittest

entry=importlib.util.spec_from_file_location('plan_verify',Path(__file__).with_name('lt-plan-verify.py'))
checker=importlib.util.module_from_spec(entry);entry.loader.exec_module(checker)

class NotificationTests(unittest.TestCase):
    def setUp(self):
        self.plan='TEST_PLAN'
        self.spec={'planMode':'new','name':'Example','ltcMgmtNo':'TEST_RECIPIENT','planNo':{'ltcMgmtNoSeq':'104','utilPlnppSeqNo':'001'},'writeDate':'2026-11-26','adptFr':'2026-12-06','adptTo':'2027-12-05','goal':'Test goal','opinion':'Test opinion','writer':'Test writer','confirmer':'Test confirmer','items':[{'name':'Test care','ftu':'TEST','cycle':'일','count':1,'minutes':10}],'subGoals':{'TEST':'Test subgoal'},'agree':{'agreeName':'Example','agreeDate':'2026-11-26','phone':'000000000'}}
        self.state={'institutionId':'TEST_INSTITUTION','plans':[{'no':self.plan,'from':'20261206','to':'20271205','seq':'104-001','trs':'','providerConfirmedAt':'20261126'}],'dtl':{'no':self.plan,'ltc':'TEST_RECIPIENT','wrtDt':'20261126','goal':'Test goal','opinion':'Test opinion','agreName':'Example','agreYn':'Y','agreDt':'20261126','phone':'000000000','writer':'Test writer','confirmer':'Test confirmer','relation':'00','method':'00','trs':'','ltcoYn':'Y','ltcoDt':'20261126'},'needs':[{'name':'Test care','ftu':'TEST'}],'groups':[{'name':'Test care','ftu':'TEST','cycle':'일','count':'1','min':'10','writer':'Test writer'}],'subGoals':[{'ftu':'TEST','text':'Test subgoal'}]}
        self.expected={'institutionId':'TEST_INSTITUTION','phone':'000000000','agreeDate':'2026-11-26'}
    def verify(self):return checker.verify(self.state,self.spec,self.plan,self.expected)
    def test_provider_confirmation_does_not_mean_transmission(self):self.assertTrue(self.verify()['ok'])
    def test_detail_transmission_rejected(self):
        self.state['dtl']['trs']='20261126';self.assertFalse(self.verify()['ok'])
    def test_list_transmission_rejected(self):
        self.state['plans'][0]['trs']='20261126';self.assertFalse(self.verify()['ok'])
    def test_missing_detail_transmission_field_rejected(self):
        del self.state['dtl']['trs'];self.assertFalse(self.verify()['ok'])
    def test_missing_list_transmission_field_rejected(self):
        del self.state['plans'][0]['trs'];self.assertFalse(self.verify()['ok'])

if __name__=='__main__':unittest.main()
